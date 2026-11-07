'use strict';
const fs=require('node:fs');
const path=require('node:path');
const REQUIRED_ARENAS=['sunset','night','dojo','underground','neon','harbor'];

function auditManifest(manifest,fileExists=()=>false){
  const required=Array.isArray(manifest.requiredLayers)?manifest.requiredLayers:[];
  const arenas=manifest.arenas&&typeof manifest.arenas==='object'?manifest.arenas:{};
  const report={requiredLayers:required,arenas:{},missingArenas:[],ready:required.length===8&&new Set(required).size===8};
  for(const id of REQUIRED_ARENAS){
    const arena=arenas[id];
    if(!arena){report.missingArenas.push(id);report.ready=false;continue;}
    const missing=required.filter(layer=>{
      const file=arena.layers?.[layer];
      if(typeof file!=='string'||!file.trim()||path.isAbsolute(file))return true;
      const resolved=path.resolve('/asset-root',file);
      if(!resolved.startsWith('/asset-root'+path.sep))return true;
      return !fileExists(file);
    });
    report.arenas[id]={title:arena.title,rendering:arena.rendering,missingLayers:missing,layerCount:required.length-missing.length};
    if(missing.length||arena.rendering!=='layered-pixel-art')report.ready=false;
  }
  if(Object.keys(arenas).length!==REQUIRED_ARENAS.length)report.ready=false;
  return report;
}
if(require.main===module){
  const strict=process.argv.includes('--strict');
  const root=path.join(__dirname,'..','public','arenas');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const report=auditManifest(manifest,file=>fs.existsSync(path.resolve(root,file))&&path.resolve(root,file).startsWith(root+path.sep));
  for(const id of REQUIRED_ARENAS){
    const arena=report.arenas[id];
    if(arena)process.stdout.write(id+': '+arena.layerCount+'/'+report.requiredLayers.length+' final layers; missing '+arena.missingLayers.join(', ')+'.\n');
    else process.stdout.write(id+': missing arena manifest entry.\n');
  }
  process.stdout.write(report.ready?'Arena art gate: PASS\n':'Arena art gate: INCOMPLETE — six original layered pixel-art environments are required.\n');
  if(strict&&!report.ready)process.exitCode=1;
}
module.exports={auditManifest,REQUIRED_ARENAS};
