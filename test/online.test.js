'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');

const port = 34000 + Math.floor(Math.random() * 10000);
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ready() {
  for (let i=0;i<80;i++) {
    try { await new Promise((resolve,reject)=>{const req=http.get(base,res=>{res.resume();resolve()});req.on('error',reject);req.setTimeout(300,reject)}); return; }
    catch { await sleep(50); }
  }
  throw new Error('server did not start');
}
function connect(code) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:'+port);
    const messages=[];
    ws.on('message',raw=>{try{messages.push(JSON.parse(raw.toString()))}catch{}});
    ws.once('open',()=>{ws.send(JSON.stringify({type:'join',code,arena:'sunset'}));resolve({ws,messages})});
    ws.once('error',reject);
  });
}
function waitFor(client,predicate,timeout=3500) {
  return new Promise((resolve,reject)=>{
    const start=Date.now();
    const poll=setInterval(()=>{
      const found=client.messages.find(predicate);
      if(found){clearInterval(poll);resolve(found)}
      else if(Date.now()-start>timeout){clearInterval(poll);reject(new Error('timed out waiting for server event'))}
    },15);
  });
}
(async()=>{
  try {
    await ready();
    const atlas=await new Promise((resolve,reject)=>http.get(base+'/fighters.svg',res=>{let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],data}))}).on('error',reject));
    assert.equal(atlas.status,200,'sprite atlas must be served');
    assert.match(atlas.type,/image\/svg\+xml/);
    assert.match(atlas.data,/<svg/);
    const code='T'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p1=await connect(code),p2=await connect(code);
    await Promise.all([waitFor(p1,m=>m.type==='match-start'),waitFor(p2,m=>m.type==='match-start')]);
    p1.ws.send(JSON.stringify({type:'state',state:{x:300,y:0,dir:1,attack:0,block:false}}));
    p2.ws.send(JSON.stringify({type:'state',state:{x:360,y:0,dir:-1,attack:0,block:false}}));
    const damage=waitFor(p2,m=>m.type==='damage');
    await sleep(80);
    p1.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    const hit=await damage;
    assert.equal(hit.playerNo,2,'damage must identify player two as victim');
    assert.equal(hit.hp,90,'a regular punch must apply ten damage');
    const heavyDamage=waitFor(p2,m=>m.type==='damage'&&m.kind==='heavyKick');
    await sleep(700);
    p1.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
    const heavy=await heavyDamage;
    assert.equal(heavy.hp,69,'a heavy kick must apply twenty-one damage');
    p1.ws.close();p2.ws.close();
    process.stdout.write('Online authoritative hit test passed.\n');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err=>{console.error(err);process.exitCode=1});
