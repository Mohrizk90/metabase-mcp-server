import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const METABASE_URL = process.env.METABASE_URL;
const METABASE_API_KEY = process.env.METABASE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOWED_DATABASES = (process.env.ALLOWED_DATABASES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!METABASE_URL || !METABASE_API_KEY) {
  console.warn(
    "[WARN] METABASE_URL and/or METABASE_API_KEY not set. Metabase calls will fail until configured."
  );
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

app.get("/health", (req, res) => {
  return res.json({ ok: true, service: "metabase-mcp-server" });
});

/**
 * Helper: call Metabase API with API key header
 */
async function callMetabase(path, method = "GET", data) {
  if (!METABASE_URL || !METABASE_API_KEY) {
    throw new Error("Metabase not configured (METABASE_URL / METABASE_API_KEY).");
  }

  const url = `${METABASE_URL.replace(/\/$/, "")}${path}`;

  const resp = await axios.request({
    url,
    method,
    data,
    headers: {
      "Content-Type": "application/json",
      "X-Metabase-Session": METABASE_API_KEY
    },
    timeout: 30000
  });

  return resp.data;
}

/**
 * POST /natural_language_to_sql
 * Body: { text: string, database_id: number, schema_hint?: string, table_hints?: string[] }
 * Uses OpenAI to turn text + hints into SQL. You can improve the prompt later.
 */
app.post("/natural_language_to_sql", async (req, res) => {
  try {
    const { text, database_id, schema_hint, table_hints } = req.body || {};

    if (!text || !database_id) {
      return res.status(400).json({ error: "text and database_id are required" });
    }

    if (ALLOWED_DATABASES.length && !ALLOWED_DATABASES.includes(String(database_id))) {
      return res.status(400).json({ error: "database_id not allowed" });
    }

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY not set on server" });
    }

    const systemPrompt = [
      "You are a SQL assistant for Metabase, generating safe, read-only SQL for PostgreSQL.",
      "RULES:",
      "- Only use SELECT statements (no INSERT/UPDATE/DELETE/ALTER/DROP).",
      "- Prefer existing tables and columns from the hints.",
      "- Do not guess table names beyond the hints; if unsure, say you are unsure.",
      "",
      schema_hint ? `SCHEMA HINT:\n${schema_hint}` : "",
      table_hints && table_hints.length
        ? `TABLE HINTS: ${table_hints.join(", ")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");

    const payload = {
      model: process.env.NL_SQL_MODEL || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ]
    };

    const openaiResp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const sql = openaiResp.data.choices?.[0]?.message?.content?.trim();

    if (!sql) {
      return res.status(500).json({ error: "No SQL generated" });
    }

    return res.json({ sql, database_id });
  } catch (err) {
    console.error("natural_language_to_sql error:", err.message || err);
    return res
      .status(500)
      .json({ error: "natural_language_to_sql failed", details: String(err.message || err) });
  }
});

/**
 * POST /create_question
 * Body: { name: string, sql: string, database_id: number }
 * Creates a Metabase native question (card) using the SQL.
 */
app.post("/create_question", async (req, res) => {
  try {
    const { name, sql, database_id } = req.body || {};

    if (!name || !sql || !database_id) {
      return res.status(400).json({ error: "name, sql, database_id are required" });
    }

    if (ALLOWED_DATABASES.length && !ALLOWED_DATABASES.includes(String(database_id))) {
      return res.status(400).json({ error: "database_id not allowed" });
    }

    const payload = {
      name,
      display: "table",
      dataset_query: {
        type: "native",
        native: {
          query: sql
        },
        database: database_id
      }
    };

    const card = await callMetabase("/api/card", "POST", payload);

    return res.json({
      question_id: card.id,
      name: card.name,
      url: card.public_uuid ? `/public/question/${card.public_uuid}` : `/question/${card.id}`
    });
  } catch (err) {
    console.error("create_question error:", err.response?.data || err.message || err);
    return res
      .status(500)
      .json({ error: "create_question failed", details: err.response?.data || String(err.message || err) });
  }
});

/**
 * POST /get_question_results
 * Body: { question_id: number }
 * Returns rows/cols for a saved question.
 */
app.post("/get_question_results", async (req, res) => {
  try {
    const { question_id } = req.body || {};

    if (!question_id) {
      return res.status(400).json({ error: "question_id is required" });
    }

    const data = await callMetabase(`/api/card/${question_id}/query`, "POST", {
      parameters: []
    });

    return res.json({
      cols: data?.data?.cols || [],
      rows: data?.data?.rows || [],
      raw: data
    });
  } catch (err) {
    console.error("get_question_results error:", err.response?.data || err.message || err);
    return res
      .status(500)
      .json({ error: "get_question_results failed", details: err.response?.data || String(err.message || err) });
  }
});

app.listen(port, () => {
  console.log(`metabase-mcp-server listening on port ${port}`);
});


