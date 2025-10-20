// server.js
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
        ($1, $2, $3), 
        ($4, $5, $6)`,
      ["Alice", "alice@example.com", "admin", "Bob", "bob@example.com", "user"]
    );
    console.log("✅ Database seeded with default users");
  } else {
    console.log("ℹ️ Users table already has data, skipping seeding");
  }
}

// -----------------------------
// Express App
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// -----------------------------
// REST Endpoints
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
    const { rows } = await db.query(
      "SELECT * FROM users WHERE id = $1",
      [req.params.id]
    );
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
// MCP Server
// -----------------------------
const mcp = new McpServer({
  serverInfo: { name: "Test MCP Server", version: "2025-03-26" },
  protocolVersion: "2025-03-26",
  capabilities: { sampling: {}, roots: [] },
});

// -----------------------------
// Register Tools for MCP
// -----------------------------
mcp.tool(
  "list_users",
  "List all users",
  z.object({}).optional(),
  async () => {
    const { rows } = await db.query("SELECT * FROM users");
    return rows;
  }
);

mcp.tool(
  "get_user",
  "Get a user by ID",
  z.object({ id: z.number() }),
  async ({ id }) => {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] || null;
  }
);

mcp.tool(
  "create_user",
  "Create a new user",
  z.object({
    name: z.string(),
    email: z.string(),
    role: z.string(),
  }),
  async ({ name, email, role }) => {
    const { rows } = await db.query(
      "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
      [name, email, role]
    );
    return rows[0];
  }
);

// -----------------------------
// MCP Endpoint
// -----------------------------
app.post("/mcp", async (req, res) => {
  try {
    const response = await mcp.handleRequest(req.body);
    res.json(response);
  } catch (err) {
    console.error("MCP Error:", err);
    res.status(500).json({
      jsonrpc: "2.0",
      id: req.body.id,
      error: { code: -32000, message: err.message },
    });
  }
});

// -----------------------------
// Start Server
// -----------------------------
async function startServer() {
  try {
    await seedDatabase();
    app.listen(PORT, () => {
      console.log(`MCP server running at http://localhost:${PORT}/mcp`);
      console.log(`REST endpoints available at http://localhost:${PORT}/tools/`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
  }
}

startServer();
