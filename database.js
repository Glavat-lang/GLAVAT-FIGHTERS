'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pool = null;
let sqlite = null;
let filePath = null;
let sqlitePath = null;
let writeQueue = Promise.resolve();
const emptyStats = () => ({matches:0,wins:0,losses:0,draws:0,knockouts:0,win_streak:0,best_streak:0,favorite_fighter:0,fighter_0_count:0,fighter_1_count:0,rating:1000});

async function init(statsFile) {
  filePath = statsFile;
  if (!process.env.DATABASE_URL && (process.env.DATABASE_MODE === 'sqlite' || process.env.SQLITE_FILE)) {
    const Database = require('better-sqlite3');
    sqlitePath = process.env.SQLITE_FILE || path.join(path.dirname(statsFile), 'glavat-fighters.sqlite');
    fs.mkdirSync(path.dirname(sqlitePath), {recursive:true});
    sqlite = new Database(sqlitePath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    const applyMigrations=sqlite.transaction(()=>{
      sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      const migrationOne=sqlite.prepare('SELECT version FROM schema_migrations WHERE version=1').get();
      if(!migrationOne)sqlite.exec(fs.readFileSync(path.join(__dirname,'migrations/sqlite/001_initial_schema.sql'),'utf8'));
      const migrationTwo=sqlite.prepare('SELECT version FROM schema_migrations WHERE version=2').get();
      if(!migrationTwo){
        const columns=sqlite.pragma('table_info(player_stats)');
        if(!columns.some(column=>column.name==='rating'))sqlite.exec(fs.readFileSync(path.join(__dirname,'migrations/sqlite/002_player_rating.sql'),'utf8'));
        else sqlite.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (2)').run();
      }
    });
    applyMigrations();
    const count = sqlite.prepare('SELECT COUNT(*) AS count FROM player_stats').get().count;
    if (count === 0) {
      try {
        const legacy = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) upsertStatsSqlite(legacy);
      } catch (error) { if (error.code !== 'ENOENT') console.error('legacy stats import skipped:', error.message); }
    }
    const rows = sqlite.prepare('SELECT * FROM player_stats').all();
    const data = {};
    for (const row of rows) data[row.player_id] = {
      matches:row.matches,wins:row.wins,losses:row.losses,draws:row.draws,knockouts:row.knockouts,
      win_streak:row.win_streak,best_streak:row.best_streak,favorite_fighter:row.favorite_fighter,
      fighter_0_count:row.fighter_0_count,fighter_1_count:row.fighter_1_count,rating:row.rating
    };
    return data;
  }
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
  const postgresMigrationOne=fs.readFileSync(path.join(__dirname,'migrations/001_initial_schema.sql'),'utf8');
  await pool.query(postgresMigrationOne);
  const postgresMigrationTwo=fs.readFileSync(path.join(__dirname,'migrations/002_player_rating.sql'),'utf8');
  await pool.query(postgresMigrationTwo);

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

function upsertStatsSqlite(data) {
  const player = sqlite.prepare('INSERT INTO players(player_id) VALUES(?) ON CONFLICT(player_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP');
  const stats = sqlite.prepare(`INSERT INTO player_stats(player_id,matches,wins,losses,draws,knockouts,win_streak,best_streak,favorite_fighter,fighter_0_count,fighter_1_count,rating)
    VALUES(@id,@matches,@wins,@losses,@draws,@knockouts,@win_streak,@best_streak,@favorite_fighter,@fighter_0_count,@fighter_1_count,@rating)
    ON CONFLICT(player_id) DO UPDATE SET matches=excluded.matches,wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,
    knockouts=excluded.knockouts,win_streak=excluded.win_streak,best_streak=excluded.best_streak,favorite_fighter=excluded.favorite_fighter,
    fighter_0_count=excluded.fighter_0_count,fighter_1_count=excluded.fighter_1_count,rating=excluded.rating,updated_at=CURRENT_TIMESTAMP`);
  for (const [id,value] of Object.entries(data)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) continue;
    player.run(id);
    stats.run({id,matches:value.matches||0,wins:value.wins||0,losses:value.losses||0,draws:value.draws||0,knockouts:value.knockouts||0,
      win_streak:value.win_streak||0,best_streak:value.best_streak||0,favorite_fighter:value.favorite_fighter||0,
      fighter_0_count:value.fighter_0_count||0,fighter_1_count:value.fighter_1_count||0,rating:Number.isInteger(value.rating)?value.rating:1000});
  }
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
  if (sqlite) { const tx=sqlite.transaction(()=>upsertStatsSqlite(data)); tx(); return; }
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
  if(sqlite&&id){sqlite.prepare('INSERT INTO players(player_id) VALUES(?) ON CONFLICT(player_id) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP').run(id);return;}
  if (!pool || !id) return;
  await pool.query('INSERT INTO players(player_id) VALUES($1) ON CONFLICT(player_id) DO UPDATE SET last_seen_at=NOW()', [id]);
}
async function recordMatch(data, match) {
  if(sqlite){const tx=sqlite.transaction(()=>{upsertStatsSqlite(data);const ids=match.playerIds||[];const valid=ids.length===2&&ids.every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id));if(valid)sqlite.prepare(`INSERT OR IGNORE INTO match_history(match_id,room_code,player_one_id,player_two_id,winner_player_id,result_reason,round_number,player_one_fighter,player_two_fighter) VALUES(?,?,?,?,?,?,?,?,?)`).run(match.matchId||crypto.randomUUID(),match.roomCode,ids[0],ids[1],match.winner===null?null:ids[match.winner],match.reason,match.round,match.fighters[0],match.fighters[1]);});tx();return;}
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
  if(sqlite)return sqlite.prepare('SELECT match_id,room_code,player_one_id,player_two_id,winner_player_id,result_reason,round_number,player_one_fighter,player_two_fighter,completed_at FROM match_history WHERE player_one_id=? OR player_two_id=? ORDER BY completed_at DESC LIMIT ?').all(id,id,Math.max(1,Math.min(50,limit)));
  if (!pool) return [];
  const result = await pool.query(`SELECT match_id,room_code,player_one_id,player_two_id,winner_player_id,
    result_reason,round_number,player_one_fighter,player_two_fighter,completed_at
    FROM match_history WHERE player_one_id=$1 OR player_two_id=$1
    ORDER BY completed_at DESC LIMIT $2`,[id,Math.max(1,Math.min(50,limit))]);
  return result.rows;
}
function safeSettings(settings) {
  const safe={};
  for(const key of ['musicVolume','effectsVolume','voiceVolume','soundOn','voiceOn']){
    const value=settings&&settings[key];
    if(typeof value==='boolean')safe[key]=value;
    else if(typeof value==='number'&&Number.isFinite(value))safe[key]=Math.max(0,Math.min(1,value));
  }
  return safe;
}
async function getSettings(id) {
  if(sqlite){const row=sqlite.prepare('SELECT settings FROM player_settings WHERE player_id=?').get(id);return row?JSON.parse(row.settings):{};}
  if (!pool) return {};
  const result = await pool.query('SELECT settings FROM player_settings WHERE player_id=$1',[id]);
  return result.rows[0]?.settings || {};
}
async function saveSettings(id, settings) {
  if(sqlite){await ensurePlayer(id);const safe=safeSettings(settings);sqlite.prepare('INSERT INTO player_settings(player_id,settings) VALUES(?,?) ON CONFLICT(player_id) DO UPDATE SET settings=excluded.settings,updated_at=CURRENT_TIMESTAMP').run(id,JSON.stringify(safe));return safe;}
  if (!pool) return {};
  await ensurePlayer(id);
  const safe = safeSettings(settings);
  await pool.query(`INSERT INTO player_settings(player_id,settings) VALUES($1,$2::jsonb)
    ON CONFLICT(player_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()`,[id,JSON.stringify(safe)]);
  return safe;
}
function isPostgres() { return !!pool; }
function isSqlite() { return !!sqlite; }
function close() { if(sqlite){sqlite.close();sqlite=null;} if(pool){return pool.end().then(()=>{pool=null;});} }
module.exports = {init,persistStats,recordMatch,ensurePlayer,getHistory,getSettings,saveSettings,isPostgres,isSqlite,close,emptyStats};
