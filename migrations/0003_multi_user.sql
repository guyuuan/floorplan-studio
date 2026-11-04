CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 0,
  legacy_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_legacy_owner ON users(legacy_owner) WHERE legacy_owner=1;
CREATE TABLE user_actions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  session_version INTEGER NOT NULL,
  UNIQUE(user_id,purpose)
);
CREATE INDEX user_actions_expiry ON user_actions(expires_at);
ALTER TABLE projects ADD COLUMN owner_id TEXT;
ALTER TABLE projects ADD COLUMN legacy_files INTEGER NOT NULL DEFAULT 0;
CREATE INDEX projects_owner_updated ON projects(owner_id,updated_at DESC);
