-- GLAVAT FIGHTERS SQLite schema migration 003: registered accounts and revocable sessions
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE REFERENCES players(player_id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS account_sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  user_agent TEXT,
  ip_prefix TEXT
);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_email_tokens (
  token_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('verify_email','password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS account_email_tokens_lookup_idx ON account_email_tokens(token_hash, purpose, expires_at);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (3);
