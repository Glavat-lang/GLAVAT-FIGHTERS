-- GLAVAT FIGHTERS SQLite schema migration 002
ALTER TABLE player_stats
  ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000 CHECK(rating >= 0);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (2);
