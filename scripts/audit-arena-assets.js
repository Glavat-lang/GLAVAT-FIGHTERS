'use strict';
const fs=require('node:fs');
const path=require('node:path');

function auditManifest(manifest,fileExists=()=>false){
  const required=manifest.requiredLayers||[];
  const arenas=manifest.arenas||{};
  const report={requiredLayers:required,arenas:{},ready:Object.keys(arenas).length===6};
  for(const [id,arena] of Object.entries(arenas)){
    const missing=required.filter(layer=>!arena.layers?.[layer]||!fileExists(arena.layers[layer]));
    report.arenas[id]={title:arena.title,rendering:arena.rendering,missingLayers:missing,layerCount:required.length-missing.length};
    if(missing.length)report.ready=false;
  }
  return report;
}
if(require.main===module){
  const strict=process.argv.includes('--strict');
  const root=path.join(__dirname,'..','public','arenas');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const report=auditManifest(manifest,file=>fs.existsSync(path.join(root,file)));
  for(const [id,arena] of Object.entries(report.arenas))process.stdout.write(id+': '+arena.layerCount+'/'+report.requiredLayers.length+' final layers; missing '+arena.missingLayers.join(', ')+'.\n');
  process.stdout.write(report.ready?'Arena art gate: PASS\n':'Arena art gate: INCOMPLETE — Canvas scenes are not final layered pixel-art environments.\n');
  if(strict&&!report.ready)process.exitCode=1;
}
module.exports={auditManifest};
