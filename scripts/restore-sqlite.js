'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
function validate(file){
  if(!fs.existsSync(file))throw new Error('Database file not found: '+file);
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const result=db.prepare('PRAGMA integrity_check').all();
    if(result.length!==1||result[0].integrity_check!=='ok')throw new Error('SQLite integrity_check failed');
    const version=db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version||0;
    if(version<2)throw new Error('Backup schema version is not supported');
    for(const table of ['players','player_stats','player_settings','match_history']){
      if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('Missing required table: '+table);
    }
    return version;
  }finally{db.close();}
}
function main(){
  const [backupArg,targetArg]=process.argv.slice(2);
  if(!backupArg||!targetArg){console.error('Usage: node scripts/restore-sqlite.js <verified-backup.sqlite> <target.sqlite>');process.exitCode=2;return;}
  const backup=path.resolve(backupArg),target=path.resolve(targetArg);
  if(backup===target)throw new Error('Backup and target must be different files');
  const version=validate(backup);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const safety=target+'.pre-restore-'+new Date().toISOString().replace(/[:.]/g,'-');
  if(fs.existsSync(target)){
    validate(target);
    fs.copyFileSync(target,safety,fs.constants.COPYFILE_EXCL);
  }
  const temp=target+'.restore-tmp';
  try{
    fs.copyFileSync(backup,temp,fs.constants.COPYFILE_EXCL);
    validate(temp);
    fs.renameSync(temp,target);
  }catch(error){
    try{fs.unlinkSync(temp)}catch{}
    if(fs.existsSync(safety)&&!fs.existsSync(target))fs.renameSync(safety,target);
    throw error;
  }
  console.log(JSON.stringify({restored:true,target,backup,schemaVersion:version,preRestoreBackup:fs.existsSync(safety)?safety:null},null,2));
  console.log('IMPORTANT: stop the application before restore; restart it only after this command succeeds.');
}
try{main()}catch(error){console.error('SQLite restore failed:',error.message);process.exitCode=1;}
