'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {auditManifest}=require('../scripts/audit-arena-assets');

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
