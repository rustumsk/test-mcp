import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHttpHandler } from "@modelcontextprotocol/sdk/server/http.js";

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
  port: process.env.DB_PORT || 5432,
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
// Express App Setup
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

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
// MCP Server Definition (HTTP)
// -----------------------------
const mcpServer = new McpServer({
  name: "user-mcp",
  version: "1.0.0",
});

// Register tools
mcpServer.registerTool(
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

mcpServer.registerTool(
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
          text:
            rows.length > 0
              ? JSON.stringify(rows[0], null, 2)
              : "User not found",
        },
      ],
    };
  }
);

mcpServer.registerTool(
  "create_user",
  {
    title: "Create a new user",
    description: "Inserts a new user into the database",
    inputSchema: {
      name: z.string().describe("Name of the user"),
      email: z.string().describe("Email address of the user"),
      role: z.string().describe("Role of the user"),
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
// Attach MCP HTTP handler
// -----------------------------
const mcpHandler = createHttpHandler(mcpServer);
app.post("/mcp", mcpHandler);

// -----------------------------
// Start Server
// -----------------------------
async function startServer() {
  try {
    await seedDatabase();
    app.listen(PORT, () => {
      console.log(`✅ MCP Server running on http://localhost:${PORT}/mcp`);
      console.log(`✅ REST endpoints on http://localhost:${PORT}/tools/`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
  }
}

startServer();
