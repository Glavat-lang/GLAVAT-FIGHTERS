-- GLAVAT FIGHTERS PostgreSQL schema migration 003: registered accounts and revocable sessions
CREATE TABLE IF NOT EXISTS accounts (
  account_id UUID PRIMARY KEY,
  player_id UUID NOT NULL UNIQUE REFERENCES players(player_id) ON DELETE CASCADE,
  username VARCHAR(24) NOT NULL,
  username_normalized VARCHAR(24) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL,
  email_normalized VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS account_sessions (
  session_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_prefix VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS account_sessions_account_idx ON account_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS account_sessions_expiry_idx ON account_sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_email_tokens (
  token_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  purpose VARCHAR(24) NOT NULL CHECK(purpose IN ('verify_email','password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS account_email_tokens_lookup_idx ON account_email_tokens(token_hash, purpose, expires_at);
INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT (version) DO NOTHING;
