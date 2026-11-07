-- GLAVAT FIGHTERS SQLite schema migration 001
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS player_stats (
  player_id TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
  matches INTEGER NOT NULL DEFAULT 0 CHECK(matches >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  knockouts INTEGER NOT NULL DEFAULT 0 CHECK(knockouts >= 0),
  win_streak INTEGER NOT NULL DEFAULT 0 CHECK(win_streak >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK(best_streak >= 0),
  favorite_fighter INTEGER NOT NULL DEFAULT 0 CHECK(favorite_fighter IN (0,1)),
  fighter_0_count INTEGER NOT NULL DEFAULT 0 CHECK(fighter_0_count >= 0),
  fighter_1_count INTEGER NOT NULL DEFAULT 0 CHECK(fighter_1_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS player_settings (
  player_id TEXT PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS match_history (
  match_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  player_one_id TEXT NOT NULL REFERENCES players(player_id),
  player_two_id TEXT NOT NULL REFERENCES players(player_id),
  winner_player_id TEXT REFERENCES players(player_id),
  result_reason TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK(round_number > 0),
  player_one_fighter INTEGER NOT NULL CHECK(player_one_fighter IN (0,1)),
  player_two_fighter INTEGER NOT NULL CHECK(player_two_fighter IN (0,1)),
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS match_history_player_one_idx ON match_history(player_one_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS match_history_player_two_idx ON match_history(player_two_id, completed_at DESC);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);
