import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pkg from "pg";
import { z } from "zod";

dotenv.config();
const { Pool } = pkg;
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
  }
}

// -----------------------------
// Express App Setup
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// -----------------------------
// MCP JSON-RPC 2.0 Handler
// -----------------------------
app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (!method) throw new Error("Missing method");
    let result;

    switch (method) {
      case "tools/list":
        result = {
          tools: [
            { name: "list_users", description: "List all users" },
            { name: "get_user", description: "Get a user by ID" },
            { name: "create_user", description: "Create a new user" },
          ],
        };
        break;

      case "tools/call":
        const { name, arguments: args } = params || {};
        if (!name) throw new Error("Missing tool name");

        if (name === "list_users") {
          const { rows } = await db.query("SELECT * FROM users");
          result = { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
        } else if (name === "get_user") {
          const schema = z.object({ id: z.number() });
          const { id } = schema.parse(args || {});
          const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [id]);
          result = { content: [{ type: "text", text: JSON.stringify(rows[0] || null, null, 2) }] };
        } else if (name === "create_user") {
          const schema = z.object({
            name: z.string(),
            email: z.string(),
            role: z.string(),
          });
          const { name, email, role } = schema.parse(args || {});
          const { rows } = await db.query(
            "INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING *",
            [name, email, role]
          );
          result = { content: [{ type: "text", text: JSON.stringify(rows[0], null, 2) }] };
        } else {
          throw new Error(`Unknown tool: ${name}`);
        }
        break;

      default:
        throw new Error(`Unknown method: ${method}`);
    }

    res.json({ jsonrpc: "2.0", id, result });
  } catch (err) {
    console.error("MCP Error:", err);
    res.json({
      jsonrpc: "2.0",
      id,
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
      console.log(`✅ MCP HTTP server ready on port ${PORT}`);
      console.log(`✅ Endpoint: https://<your-render-app>.onrender.com/mcp`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
  }
}

startServer();
