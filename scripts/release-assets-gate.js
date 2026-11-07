'use strict';
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const scripts=['audit-animation-assets.js','audit-arena-assets.js'];
let failed=false;
for(const script of scripts){
  const file=path.join(__dirname,script);
  const result=spawnSync(process.execPath,[file,'--strict'],{encoding:'utf8'});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.status!==0)failed=true;
}
if(failed){process.stderr.write('Release asset gate: BLOCKED\n');process.exitCode=1;}
else process.stdout.write('Release asset gate: PASS\n');
