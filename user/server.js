import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();
const PORT = process.env.PORT || 3000;

// connect to MySQL
const db = await mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// -----------------------------
// DEFINE YOUR TOOLS
// -----------------------------
const tools = {
  list_users: {
    description: "List all users",
    handler: async () => {
      const [rows] = await db.query("SELECT * FROM users");
      return rows;
    },
  },
  get_user: {
    description: "Get a user by ID",
    handler: async ({ id }) => {
      const [rows] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
      return rows[0] || null;
    },
  },
  create_user: {
    description: "Create a new user",
    handler: async ({ name, email, role }) => {
      const [result] = await db.query(
        "INSERT INTO users (name, email, role) VALUES (?, ?, ?)",
        [name, email, role]
      );
      return { id: result.insertId, name, email, role };
    },
  },
};

// -----------------------------
// MCP SERVER (JSON-RPC HANDLER)
// -----------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// this is your main MCP endpoint
app.post("/mcp", async (req, res) => {
  const { id, method, params } = req.body;

  try {
    // 1️⃣ Return list of tools
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

    // 2️⃣ Invoke a tool
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

    // 3️⃣ If unknown method
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
