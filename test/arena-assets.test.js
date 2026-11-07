'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {auditManifest}=require('../scripts/audit-arena-assets');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const layers=['sky','far_skyline','near_skyline','architecture','fence','foreground','lighting','reflections'];
function fixture(complete=true){
  const arenas={};
  for(const id of ['sunset','night','dojo','underground','neon','harbor']){
    const files={};for(const layer of layers)if(complete)files[layer]=id+'/'+layer+'.png';
    arenas[id]={title:id,rendering:'layered-pixel-art',layers:files};
  }
  return {requiredLayers:layers,arenas};
}

test('accepts six arenas with all required original art layers',()=>{
  const report=auditManifest(fixture(true),()=>true);
  assert.equal(report.ready,true);
  assert.equal(Object.keys(report.arenas).length,6);
});

test('rejects Canvas-only scenes without layered pixel-art assets',()=>{
  const report=auditManifest(fixture(false),()=>false);
  assert.equal(report.ready,false);
  assert.equal(report.arenas.sunset.layerCount,0);
  assert.equal(report.arenas.harbor.missingLayers.length,8);
});

test('rejects a missing required arena and path traversal',()=>{
  const data=fixture(true);
  delete data.arenas.harbor;
  data.arenas.sunset.layers.sky='../../outside.png';
  const report=auditManifest(data,()=>true);
  assert.equal(report.ready,false);
  assert.deepEqual(report.missingArenas,['harbor']);
  assert.ok(report.arenas.sunset.missingLayers.includes('sky'));
});

test('strict release gate refuses current Canvas-only production candidate',()=>{
  const script=path.join(__dirname,'../scripts/audit-arena-assets.js');
  const result=spawnSync(process.execPath,[script,'--strict'],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stdout,/Arena art gate: INCOMPLETE/);
});
