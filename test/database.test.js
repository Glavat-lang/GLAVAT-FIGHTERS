'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'glavat-db-'));
const legacyPath=path.join(root,'fighter-stats.json');
const sqlitePath=path.join(root,'fighter-stats.sqlite');
const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
fs.writeFileSync(legacyPath,JSON.stringify({[first]:{matches:2,wins:1,losses:1,draws:0,knockouts:1,win_streak:0,best_streak:1,favorite_fighter:0,fighter_0_count:2,fighter_1_count:0}}));
process.env.DATABASE_MODE='sqlite';
process.env.SQLITE_FILE=sqlitePath;
delete process.env.DATABASE_URL;
const database=require('../database');
(async()=>{
 try{
  const loaded=await database.init(legacyPath);
  assert.equal(loaded[first].matches,2,'legacy JSON stats must import into SQLite');
  assert.equal(loaded[first].rating,1000,'legacy records must receive the default rating');
  await database.ensurePlayer(second);
  const stats={...loaded,[second]:{...database.emptyStats(),matches:1,wins:1,rating:1016}};
  await database.recordMatch(stats,{matchId:'33333333-3333-4333-8333-333333333333',roomCode:'SQLITE1',playerIds:[first,second],fighters:[0,1],winner:1,reason:'ko',round:2});
  const history=await database.getHistory(second,10);
  assert.equal(history.length,1,'SQLite must retain match history');
  assert.equal(history[0].winner_player_id,second,'SQLite match history must preserve the winner');
  const settings=await database.saveSettings(second,{musicVolume:.35,effectsVolume:.8,voiceVolume:.4,soundOn:false,voiceOn:true,unknown:'discard'});
  assert.deepEqual(settings,{musicVolume:.35,effectsVolume:.8,voiceVolume:.4,soundOn:false,voiceOn:true},'settings must be filtered and persisted');
  assert.deepEqual(await database.getSettings(second),settings,'player settings must survive a read after write');
  await database.close();
  const reopened=await database.init(legacyPath);
  assert.equal(reopened[second].rating,1016,'ratings must survive closing and reopening the SQLite database');
  assert.equal(reopened[first].wins,1,'imported legacy stats must remain durable');
  const raw=new Database(sqlitePath,{readonly:true});
  const versions=raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(x=>x.version);
  assert.deepEqual(versions,[1,2],'SQLite schema migrations must be versioned');
  raw.close();
  await database.close();
  process.stdout.write('SQLite persistence, legacy import, match history, settings, Elo rating and migrations passed.\\n');
 }finally{
  try{await database.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
