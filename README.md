# Metabase MCP Server (Minimal)

A small Node.js HTTP service that acts as an MCP-style wrapper around Metabase:

- `/natural_language_to_sql` – uses OpenAI to turn a natural-language question into **read-only SQL**.
- `/create_question` – creates a Metabase native question (card) from SQL.
- `/get_question_results` – runs a saved question and returns rows/columns.

You can run this on the same DigitalOcean droplet as Metabase, then call it from n8n as HTTP tools.

## 1. Configuration

Create a `.env` file next to `package.json`:

```bash
cd metabase-mcp-server
cp .env.example .env   # if you have it, otherwise create .env manually
```

Required variables:

- `METABASE_URL` – e.g. `https://metabase.yourdomain.com`
- `METABASE_API_KEY` – Metabase API key or session token
- `OPENAI_API_KEY` – OpenAI key used for NL→SQL
- `ALLOWED_DATABASES` – comma‑separated Metabase DB IDs you allow (e.g. `2`)
- `NL_SQL_MODEL` – (optional) OpenAI model, default `gpt-4.1-mini`

## 2. Local run (for testing)

```bash
cd metabase-mcp-server
npm install
npm run dev
```

Health check:

```bash
curl http://localhost:4000/health
```

## 3. Docker build & run (for your DO droplet)

On your droplet:

```bash
cd /opt
git clone <your_repo_url> order-db-bot-mcp
cd order-db-bot-mcp/metabase-mcp-server

cp .env.example .env    # or upload your own .env
vi .env                 # fill METABASE_URL, METABASE_API_KEY, OPENAI_API_KEY, ALLOWED_DATABASES

docker build -t metabase-mcp:latest .

docker run -d --name metabase-mcp \
  --env-file /opt/order-db-bot-mcp/metabase-mcp-server/.env \
  -p 4000:4000 \
  metabase-mcp:latest
```

Then:

```bash
curl http://localhost:4000/health
```

## 4. Example requests

### 4.1 natural_language_to_sql

```bash
curl -X POST http://localhost:4000/natural_language_to_sql \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Monthly invoice totals for 2024",
    "database_id": 2,
    "table_hints": ["invoices"]
  }'
```

Response:

```json
{ "sql": "SELECT ...", "database_id": 2 }
```

### 4.2 create_question

```bash
curl -X POST http://localhost:4000/create_question \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monthly invoice totals 2024",
    "sql": "SELECT ...",
    "database_id": 2
  }'
```

### 4.3 get_question_results

```bash
curl -X POST http://localhost:4000/get_question_results \
  -H "Content-Type: application/json" \
  -d '{ "question_id": 123 }'
```

## 5. Wiring into n8n

In n8n, create HTTP Request (Tool) nodes that call:

- `POST /natural_language_to_sql` – when the user asks for aggregates/trends/charts.
- `POST /create_question` – to persist a question you want to reuse.
- `POST /get_question_results` – to fetch data for charts or tables.

Use environment variables/credentials in n8n to store:

- `MCP_BASE_URL` – e.g. `http://metabase-prod:4000` or `https://mcp.yourdomain.com`.

Then your AI Agent can call these as tools instead of crafting SQL entirely from the prompt.


