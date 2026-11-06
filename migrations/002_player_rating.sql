-- GLAVAT FIGHTERS PostgreSQL schema migration 002
ALTER TABLE player_stats
  ADD COLUMN IF NOT EXISTS rating INTEGER NOT NULL DEFAULT 1000 CHECK (rating >= 0);
INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT (version) DO NOTHING;
