'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function auditAtlas(svg,requiredFrames=25){
  const frames={1:[],2:[]};
  const pattern=/<g id="p([12])f(\d+)"[^>]*>([\s\S]*?)<\/g>/g;
  for(const match of svg.matchAll(pattern)){
    const fighter=Number(match[1]);
    const frameId=Number(match[2]);
    const frameContent=match[3].replace(/\s+/g,' ').trim();
    frames[fighter].push({frameId,content:frameContent,usesSharedSymbols:/<use\s+href="#p[12](?:body|arm|leg)"/.test(frameContent),hash:crypto.createHash('sha256').update(frameContent).digest('hex')});
  }
  const report={requiredFrames,fighters:{}};
  for(const fighter of [1,2]){
    const list=frames[fighter];
    const standalone=list.filter(frame=>!frame.usesSharedSymbols);
    const unique=new Set(standalone.map(frame=>frame.hash));
    report.fighters[fighter]={frameCount:list.length,uniqueFrameCount:unique.size,standaloneFrameCount:standalone.length,sharedSymbolFrames:list.length-standalone.length,missingFrames:Math.max(0,requiredFrames-list.length)};
  }
  report.ready=[1,2].every(id=>report.fighters[id].frameCount>=requiredFrames&&report.fighters[id].standaloneFrameCount>=requiredFrames&&report.fighters[id].uniqueFrameCount>=requiredFrames);
  return report;
}

if(require.main===module){
  const strict=process.argv.includes('--strict');
  const file=path.join(__dirname,'..','public','fighters.svg');
  const report=auditAtlas(fs.readFileSync(file,'utf8'));
  for(const id of [1,2]){
    const fighter=report.fighters[id];
    process.stdout.write('Fighter '+id+': '+fighter.frameCount+'/'+report.requiredFrames+' poses; '+fighter.standaloneFrameCount+' standalone drawings; '+fighter.uniqueFrameCount+' unique standalone frames; '+fighter.sharedSymbolFrames+' symbol-composed poses.\n');
  }
  if(report.ready)process.stdout.write('Animation asset gate: PASS\n');
  else{
    process.stdout.write('Animation asset gate: INCOMPLETE — final frame-by-frame art is not ready.\n');
    if(strict)process.exitCode=1;
  }
}
module.exports={auditAtlas};
