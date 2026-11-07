'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

function quote(value){return "'"+String(value).replace(/'/g,"''")+"'";}
function validateDatabase(file){
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw new Error('SQLite integrity_check failed: '+JSON.stringify(integrity));
    const version=db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version||0;
    if(version<4)throw new Error('Database schema is older than required version 4');
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('players','player_stats','player_settings','match_history','accounts','account_sessions','account_email_tokens','auth_rate_limits') ORDER BY name").all().map(x=>x.name);
    if(tables.length!==8)throw new Error('Required player, statistics, history and account-security tables are missing');
    const counts={};
    for(const table of tables)counts[table]=db.prepare('SELECT COUNT(*) AS count FROM "'+table+'"').get().count;
    return {schemaVersion:version,counts};
  }finally{db.close();}
}
function main(){
  const [mode,source,destination]=process.argv.slice(2);
  if(!['backup','verify'].includes(mode)||!source||(mode==='backup'&&!destination)){
    console.error('Usage: node scripts/sqlite-maintenance.js backup <database.sqlite> <backup.sqlite> | verify <backup.sqlite>');
    process.exitCode=2;return;
  }
  const src=path.resolve(source);
  if(!fs.existsSync(src))throw new Error('Source database does not exist: '+src);
  const before=validateDatabase(src);
  if(mode==='verify'){
    console.log(JSON.stringify({verified:true,file:src,...before},null,2));return;
  }
  const dest=path.resolve(destination);
  if(src===dest)throw new Error('Backup destination must differ from source');
  if(fs.existsSync(dest))throw new Error('Refusing to overwrite an existing backup');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  const db=new DatabaseSync(src);
  try{
    db.exec('PRAGMA wal_checkpoint(FULL)');
    db.exec('VACUUM INTO '+quote(dest));
  }finally{db.close();}
  try{
    const after=validateDatabase(dest);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Backup verification mismatch: source and backup table counts differ');
    console.log(JSON.stringify({created:true,source:src,backup:dest,...after},null,2));
  }catch(error){try{fs.unlinkSync(dest)}catch{}throw error;}
}
try{main()}catch(error){console.error('SQLite maintenance failed:',error.message);process.exitCode=1;}
