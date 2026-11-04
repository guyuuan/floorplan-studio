CREATE TABLE IF NOT EXISTS user_mcp_tokens (
  username TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
