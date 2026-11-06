'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pool = null;
let filePath = null;
let writeQueue = Promise.resolve();
const emptyStats = () => ({matches:0,wins:0,losses:0,draws:0,knockouts:0,win_streak:0,best_streak:0,favorite_fighter:0,fighter_0_count:0,fighter_1_count:0,rating:1000});

async function init(statsFile) {
  filePath = statsFile;
  if (!process.env.DATABASE_URL) {
    fs.mkdirSync(path.dirname(filePath), {recursive:true});
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.writeFileSync(filePath, '{}', {mode:0o600});
      return {};
    }
  }

  const {Pool} = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : {rejectUnauthorized:false},
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  await pool.query('SELECT 1');
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS players (
    player_id UUID PRIMARY KEY,
    display_name VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS player_stats (
    player_id UUID PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
    matches INTEGER NOT NULL DEFAULT 0 CHECK (matches >= 0),
    wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
    draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
    knockouts INTEGER NOT NULL DEFAULT 0 CHECK (knockouts >= 0),
    win_streak INTEGER NOT NULL DEFAULT 0 CHECK (win_streak >= 0),
    best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
    favorite_fighter SMALLINT NOT NULL DEFAULT 0 CHECK (favorite_fighter IN (0,1)),
    fighter_0_count INTEGER NOT NULL DEFAULT 0 CHECK (fighter_0_count >= 0),
    fighter_1_count INTEGER NOT NULL DEFAULT 0 CHECK (fighter_1_count >= 0),
    rating INTEGER NOT NULL DEFAULT 1000 CHECK (rating >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS player_settings (
    player_id UUID PRIMARY KEY REFERENCES players(player_id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS match_history (
    match_id UUID PRIMARY KEY,
    room_code VARCHAR(8) NOT NULL,
    player_one_id UUID NOT NULL REFERENCES players(player_id),
    player_two_id UUID NOT NULL REFERENCES players(player_id),
    winner_player_id UUID REFERENCES players(player_id),
    result_reason VARCHAR(16) NOT NULL,
    round_number INTEGER NOT NULL CHECK (round_number > 0),
    player_one_fighter SMALLINT NOT NULL CHECK (player_one_fighter IN (0,1)),
    player_two_fighter SMALLINT NOT NULL CHECK (player_two_fighter IN (0,1)),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS rating INTEGER NOT NULL DEFAULT 1000 CHECK (rating >= 0)');
  await pool.query('INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT (version) DO NOTHING');
  await pool.query('CREATE INDEX IF NOT EXISTS match_history_player_one_idx ON match_history(player_one_id, completed_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS match_history_player_two_idx ON match_history(player_two_id, completed_at DESC)');
  await pool.query('INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING');

  const count = await pool.query('SELECT COUNT(*)::int AS count FROM player_stats');
  if (count.rows[0].count === 0) {
    try {
      const legacy = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) await upsertStats(legacy);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('legacy stats import skipped:', error.message);
    }
  }
  const result = await pool.query(`SELECT player_id, matches, wins, losses, draws, knockouts,
    win_streak, best_streak, favorite_fighter, fighter_0_count, fighter_1_count, rating FROM player_stats`);
  const data = {};
  for (const row of result.rows) data[row.player_id] = {
    matches:row.matches,wins:row.wins,losses:row.losses,draws:row.draws,knockouts:row.knockouts,
    win_streak:row.win_streak,best_streak:row.best_streak,favorite_fighter:row.favorite_fighter,
    fighter_0_count:row.fighter_0_count,fighter_1_count:row.fighter_1_count,rating:row.rating
  };
  return data;
}

async function upsertStats(data, client=pool) {
  for (const [id, value] of Object.entries(data)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) continue;
    await client.query('INSERT INTO players(player_id) VALUES($1) ON CONFLICT(player_id) DO UPDATE SET last_seen_at=NOW()', [id]);
    await client.query(`INSERT INTO player_stats(player_id,matches,wins,losses,draws,knockouts,win_streak,best_streak,favorite_fighter,fighter_0_count,fighter_1_count,rating)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(player_id) DO UPDATE SET matches=EXCLUDED.matches,wins=EXCLUDED.wins,losses=EXCLUDED.losses,
      draws=EXCLUDED.draws,knockouts=EXCLUDED.knockouts,win_streak=EXCLUDED.win_streak,best_streak=EXCLUDED.best_streak,
      favorite_fighter=EXCLUDED.favorite_fighter,fighter_0_count=EXCLUDED.fighter_0_count,
      fighter_1_count=EXCLUDED.fighter_1_count,rating=EXCLUDED.rating,updated_at=NOW()`,
    [id,value.matches||0,value.wins||0,value.losses||0,value.draws||0,value.knockouts||0,value.win_streak||0,
      value.best_streak||0,value.favorite_fighter||0,value.fighter_0_count||0,value.fighter_1_count||0,Number.isInteger(value.rating)?value.rating:1000]);
  }
}

async function persistStats(data) {
  if (pool) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await upsertStats(data, client); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return;
  }
  const snapshot = JSON.stringify(data), tmp = filePath + '.tmp';
  writeQueue = writeQueue.then(() => fs.promises.writeFile(tmp,snapshot,{mode:0o600}))
    .then(() => fs.promises.rename(tmp,filePath));
  return writeQueue;
}

async function ensurePlayer(id) {
  if (!pool || !id) return;
  await pool.query('INSERT INTO players(player_id) VALUES($1) ON CONFLICT(player_id) DO UPDATE SET last_seen_at=NOW()', [id]);
}
async function recordMatch(data, match) {
  if (!pool) return persistStats(data);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertStats(data, client);
    const validPlayerIds = Array.isArray(match.playerIds) && match.playerIds.length===2 &&
      match.playerIds.every(id=>typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
    if(validPlayerIds) await client.query(`INSERT INTO match_history(match_id,room_code,player_one_id,player_two_id,winner_player_id,result_reason,round_number,player_one_fighter,player_two_fighter)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(match_id) DO NOTHING`,
    [match.matchId||crypto.randomUUID(),match.roomCode,match.playerIds[0],match.playerIds[1],
      match.winner===null?null:match.playerIds[match.winner],match.reason,match.round,
      match.fighters[0],match.fighters[1]]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function getHistory(id, limit=20) {
  if (!pool) return [];
  const result = await pool.query(`SELECT match_id,room_code,player_one_id,player_two_id,winner_player_id,
    result_reason,round_number,player_one_fighter,player_two_fighter,completed_at
    FROM match_history WHERE player_one_id=$1 OR player_two_id=$1
    ORDER BY completed_at DESC LIMIT $2`,[id,Math.max(1,Math.min(50,limit))]);
  return result.rows;
}
async function getSettings(id) {
  if (!pool) return {};
  const result = await pool.query('SELECT settings FROM player_settings WHERE player_id=$1',[id]);
  return result.rows[0]?.settings || {};
}
async function saveSettings(id, settings) {
  if (!pool) return {};
  await ensurePlayer(id);
  const safe = {};
  for (const key of ['musicVolume','effectsVolume','voiceVolume','soundOn','voiceOn']) {
    const value = settings && settings[key];
    if (typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.max(0,Math.min(1,value));
  }
  await pool.query(`INSERT INTO player_settings(player_id,settings) VALUES($1,$2::jsonb)
    ON CONFLICT(player_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()`,[id,JSON.stringify(safe)]);
  return safe;
}
function isPostgres() { return !!pool; }
module.exports = {init,persistStats,recordMatch,ensurePlayer,getHistory,getSettings,saveSettings,isPostgres,emptyStats};
