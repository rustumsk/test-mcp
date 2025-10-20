import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
const { Pool } = pkg;

dotenv.config();
const PORT = process.env.PORT || 3000;

// connect to PostgreSQL
const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false, // Render uses a self-signed cert
  },
});

// -----------------------------
// SEED DATABASE
// -----------------------------
async function seedDatabase() {
  // Create table if it doesn't exist
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(255),
      role VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if table already has users
  const { rows } = await db.query("SELECT COUNT(*) AS count FROM users");
  if (parseInt(rows[0].count) === 0) {
    await db.query(
      `INSERT INTO users (name, email, role) VALUES
       ($1, $2, $3),
       ($4, $5, $6)`,
      ["Alice", "alice@example.com", "admin", "Bob", "bob@example.com", "user"]
    );
    console.log("✅ Database seeded with default users");
  } else {
    console.log("ℹ️ Users table already has data, skipping seeding");
  }
}

// Run seeding on startup
await seedDatabase();

// -----------------------------
// DEFINE YOUR TOOLS
// -----------------------------
const tools = {
  list_users: {
    description: "List all users",
    handler: async () => {
      const { rows } = await db.query("SELECT * FROM users");
      return rows;
    },
  },
  get_user: {
    description: "Get a user by ID",
    handler: async ({ id }) => {
      const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
      return rows[0] || null;
    },
  },
  create_user: {
    description: "Create a new user",
    handler: async ({ name, email, role }) => {
      const { rows } = await db.query(
        "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
        [name, email, role]
      );
      return rows[0];
    },
  },
};

// -----------------------------
// MCP SERVER (JSON-RPC HANDLER)
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body;

  try {
    if (method === "mcp/get_tools") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
          })),
        },
      });
    }

    if (method === "mcp/invoke_tool") {
      const { name, args } = params || {};
      const tool = tools[name];
      if (!tool) {
        return res.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${name}` },
        });
      }

      const result = await tool.handler(args || {});
      return res.json({
        jsonrpc: "2.0",
        id,
        result,
      });
    }

    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Unknown method" },
    });
  } catch (err) {
    console.error(err);
    return res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err.message },
    });
  }
});

app.listen(PORT, () => {
  console.log(`MCP server running at http://localhost:${PORT}/mcp`);
});
