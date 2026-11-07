-- GLAVAT FIGHTERS PostgreSQL schema migration 004: persistent hashed rate-limit buckets
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx ON auth_rate_limits(expires_at);
INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT (version) DO NOTHING;
