import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const { Pool } = pkg;
dotenv.config();

const PORT = process.env.PORT || 3000;

// -----------------------------
// PostgreSQL Setup
// -----------------------------
const db = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
  ssl: { rejectUnauthorized: false },
});

// -----------------------------
// Seed Database
// -----------------------------
async function seedDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(255),
      role VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const { rows } = await db.query("SELECT COUNT(*) AS count FROM users");
  if (parseInt(rows[0].count) === 0) {
    await db.query(`
      INSERT INTO users (name, email, role) VALUES
      ('Alice', 'alice@example.com', 'admin'),
      ('Bob', 'bob@example.com', 'user')
    `);
    console.log("✅ Database seeded with default users");
  } else {
    console.log("ℹ️ Users table already has data, skipping seeding");
  }
}

// -----------------------------
// Express Setup
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Health check (optional)
app.get("/", (_, res) => res.send("✅ MCP server is running"));

// -----------------------------
// REST Endpoints (for manual testing)
// -----------------------------
app.get("/tools/list_users", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/tools/get_user/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [
      req.params.id,
    ]);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/tools/create_user", async (req, res) => {
  const { name, email, role } = req.body;
  try {
    const { rows } = await db.query(
      "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
      [name, email, role]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------
// MCP Server Setup
// -----------------------------
const server = new McpServer({
  name: "user-mcp",
  version: "1.0.0",
});

// MCP Tools
server.registerTool(
  "list_users",
  {
    title: "List all users",
    description: "Returns all users from the database",
    inputSchema: {},
  },
  async () => {
    const { rows } = await db.query("SELECT * FROM users ORDER BY id ASC");
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

server.registerTool(
  "get_user",
  {
    title: "Get user by ID",
    description: "Retrieve a user from the database by ID",
    inputSchema: { id: z.number().describe("User ID") },
  },
  async ({ id }) => {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return {
      content: [
        {
          type: "text",
          text: rows.length
            ? JSON.stringify(rows[0], null, 2)
            : "User not found",
        },
      ],
    };
  }
);

server.registerTool(
  "create_user",
  {
    title: "Create a new user",
    description: "Inserts a new user into the database",
    inputSchema: {
      name: z.string(),
      email: z.string(),
      role: z.string(),
    },
  },
  async ({ name, email, role }) => {
    const { rows } = await db.query(
      "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
      [name, email, role]
    );
    return {
      content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }],
    };
  }
);

// -----------------------------
// MCP HTTP Endpoint (New Convention)
// -----------------------------
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", transport.close.bind(transport));

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// -----------------------------
// Start Server
// -----------------------------
async function startServer() {
  try {
    await db.query("SELECT 1");
    console.log("✅ Database connection successful.");
    await seedDatabase();

    app.listen(PORT, () => {
      console.log(`✅ MCP Server running on http://localhost:${PORT}/mcp`);
      console.log(`✅ REST endpoints on http://localhost:${PORT}/tools/`);
    });
  } catch (err) {
    console.error("❌ Failed to start server or connect to DB:", err.message);
    process.exit(1);
  }
}

startServer();
