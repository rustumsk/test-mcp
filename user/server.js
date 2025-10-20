import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
    await db.query(
      `INSERT INTO users (name, email, role) VALUES
        ('Alice', 'alice@example.com', 'admin'),
        ('Bob', 'bob@example.com', 'user')`
    );
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
// MCP Server Definition (per official SDK)
// -----------------------------
const mcpServer = new McpServer({
  name: "User Management MCP",
  version: "1.0.0",
});

// Register tools — compliant with the SDK pattern
mcpServer.tool(
  "list_users",
  "List all users in the database",
  {},
  async () => {
    const { rows } = await db.query("SELECT * FROM users");
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

mcpServer.tool(
  "get_user",
  "Retrieve a user by ID",
  { id: z.number().describe("User ID") },
  async ({ id }) => {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return {
      content: [
        { type: "text", text: JSON.stringify(rows[0] || null, null, 2) },
      ],
    };
  }
);

mcpServer.tool(
  "create_user",
  "Create a new user in the database",
  {
    name: z.string().describe("Name of the user"),
    email: z.string().describe("Email address of the user"),
    role: z.string().describe("Role of the user"),
  },
  async ({ name, email, role }) => {
    const { rows } = await db.query(
      "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
      [name, email, role]
    );
    return {
      content: [
        { type: "text", text: JSON.stringify(rows[0], null, 2) },
      ],
    };
  }
);

// -----------------------------
// Attach MCP server to Express (per MCP SDK spec)
// -----------------------------
// This exposes /mcp with full JSON-RPC 2.0 compliance
app.use("/mcp", mcpServer.express());

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
