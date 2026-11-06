'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const WebSocket = require('ws');

const port = 34000 + Math.floor(Math.random() * 10000);
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
let childOutput='',childExit=null;child.stdout.on('data',x=>childOutput+=x);child.stderr.on('data',x=>childOutput+=x);child.on('error',e=>childOutput+=' spawn error: '+e.message);child.on('exit',(code,signal)=>{childExit={code,signal}});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ready() {
  for (let i=0;i<80;i++) {
    try { await new Promise((resolve,reject)=>{const req=http.get(base,res=>{res.resume();resolve()});req.on('error',reject);req.setTimeout(300,reject)}); return; }
    catch { await sleep(50); }
  }
  throw new Error('server did not start; exit: '+JSON.stringify(childExit)+'; child output: '+childOutput);
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
function waitFor(client,predicate,timeout=5000) {
  return new Promise((resolve,reject)=>{
    const start=Date.now();
    const poll=setInterval(()=>{
      const found=client.messages.find(predicate);
      if(found){clearInterval(poll);resolve(found)}
      else if(Date.now()-start>timeout){clearInterval(poll);reject(new Error('timed out waiting for server event; received: '+client.messages.map(m=>m.type+(m.kind?':'+m.kind:'')).join(', ')+'; last players='+JSON.stringify(client.messages.filter(m=>m.type==='snapshot').at(-1)?.players)))}
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
    assert.equal((atlas.data.match(/id="p1f\d+"/g)||[]).length,17,'fighter one must have 17 distinct poses');
    assert.equal((atlas.data.match(/id="p2f\d+"/g)||[]).length,17,'fighter two must have 17 distinct poses');
    const code='T'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p1=await connect(code),p2=await connect(code);
    await Promise.all([waitFor(p1,m=>m.type==='match-start'),waitFor(p2,m=>m.type==='match-start')]);
    const no=c=>c.messages.find(m=>m.type==='joined')?.playerNo;
    const attacker=no(p1)===1?p1:p2,defender=attacker===p1?p2:p1;
    const initial=await waitFor(attacker,m=>m.type==='snapshot'&&m.players?.every(Boolean));
    assert.equal(initial.players[0].x,290,'round reset must spawn player one at 290');
    assert.equal(initial.players[1].x,710,'round reset must spawn player two at 710');
    attacker.ws.send(JSON.stringify({type:'input',input:{right:true,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:true,face:-1}}));
    await sleep(500);
    attacker.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:false,face:-1}}));
    const airborne=waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y< -10);
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:true,right:false,face:1}}));
    await airborne;
    const airHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='airKick');
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'airKick'}}));
    const air=await airHit;
    assert.equal(air.damage,15,'air kick must apply its own damage');
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:false,face:1}}));
    await waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y===0,2500);
    const damage=waitFor(defender,m=>m.type==='damage'&&m.kind==='punch');
    await sleep(80);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    const hit=await damage;
    assert.equal(hit.playerNo,2,'damage must identify the second slot as victim');
    assert.equal(hit.hp,90,'a regular punch must apply ten damage');
    const heavyDamage=waitFor(defender,m=>m.type==='damage'&&m.kind==='heavyKick');
    await sleep(700);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
    const heavy=await heavyDamage;
    assert.equal(heavy.hp,69,'a heavy kick must apply twenty-one damage');
    const blockHit=waitFor(defender,m=>m.type==='damage'&&m.blocked===true);
    defender.ws.send(JSON.stringify({type:'input',input:{block:true,face:-1}}));
    await sleep(700);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    const blocked=await blockHit;
    assert.equal(blocked.blocked,true,'holding block must reduce incoming damage');
    assert.equal(blocked.damage,2,'blocked punch must deal chip damage only');
    defender.ws.send(JSON.stringify({type:'input',input:{block:false,face:-1}}));
    await sleep(25);
    const counterHit=waitFor(attacker,m=>m.type==='damage'&&m.kind==='counter');
    defender.ws.send(JSON.stringify({type:'attack',attack:{kind:'counter'}}));
    const counter=await counterHit;
    assert.equal(counter.damage,18,'a successful block must enable a counterattack');
    const grabHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='grab');
    const grabStart=waitFor(attacker,m=>m.type==='attack-start'&&m.kind==='grab');
    await sleep(800);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'grab'}}));
    await grabStart;
    const grabbed=await grabHit;
    assert.equal(grabbed.damage,20,'grab must bypass guard and deal throw damage');
    const third=await connect(code);
    await waitFor(third,m=>m.type==='room-full');
    const otherCode='X'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p3=await connect(otherCode),p4=await connect(otherCode);
    await Promise.all([waitFor(p3,m=>m.type==='match-start'),waitFor(p4,m=>m.type==='match-start')]);
    defender.ws.close();
    await waitFor(attacker,m=>m.type==='opponent-left');
    const rejoin=await connect(code);
    await Promise.all([waitFor(attacker,m=>m.type==='match-start'),waitFor(rejoin,m=>m.type==='match-start')]);
    attacker.ws.close();rejoin.ws.close();third.ws.close();p3.ws.close();p4.ws.close();
    process.stdout.write('Online combat, jump, air attack, guard, counter, grab, room capacity, isolation and reconnect tests passed.\\n');
  } finally {
    child.kill('SIGTERM');
  }
})().catch(err=>{console.error(err);process.exitCode=1});
