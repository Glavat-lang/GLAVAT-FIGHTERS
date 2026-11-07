'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {auditAtlas}=require('../scripts/audit-animation-assets');

function fixture(count,{shared=false,duplicate=false}={}){
  let svg='<svg>';
  for(const fighter of [1,2]){
    if(shared)svg+='<symbol id="p'+fighter+'body"><path d="M0 0h1v1z"/></symbol>';
    for(let frame=0;frame<count;frame++){
      const shape=duplicate?'M0 0h1v1z':'M'+frame+' 0h1v1z';
      svg+='<g id="p'+fighter+'f'+frame+'">'+(shared?'<use href="#p'+fighter+'body" transform="translate('+frame+' 0)"/>':'<path d="'+shape+'"/>')+'</g>';
    }
  }
  return svg+'</svg>';
}

test('accepts 25 unique standalone hand-authored frames per fighter',()=>{
  const report=auditAtlas(fixture(25));
  assert.equal(report.ready,true);
  assert.equal(report.fighters[1].uniqueFrameCount,25);
  assert.equal(report.fighters[2].standaloneFrameCount,25);
});

test('rejects the current 17-pose shared-symbol construction',()=>{
  const report=auditAtlas(fixture(17,{shared:true}));
  assert.equal(report.ready,false);
  assert.equal(report.fighters[1].missingFrames,8);
  assert.equal(report.fighters[1].sharedSymbolFrames,17);
  assert.equal(report.fighters[2].standaloneFrameCount,0);
});

test('rejects repeated standalone frame drawings',()=>{
  const report=auditAtlas(fixture(25,{duplicate:true}));
  assert.equal(report.ready,false);
  assert.equal(report.fighters[1].uniqueFrameCount,1);
});


test('strict release animation gate fails on the current incomplete atlas',()=>{
  const script=path.join(__dirname,'../scripts/audit-animation-assets.js');
  const result=spawnSync(process.execPath,[script,'--strict'],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stdout,/0 standalone drawings/);
  assert.match(result.stdout,/Animation asset gate: INCOMPLETE/);
});
