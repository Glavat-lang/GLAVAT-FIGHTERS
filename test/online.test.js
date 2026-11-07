'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const WebSocket = require('ws');
const {DatabaseSync}=require('node:sqlite');

let port=0,base='',statsFile='',sqliteFile='',child;
const clients = new Set();
let childOutput='',childExit=null,restartChild=null,restartOutput='';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function reservePort(){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const selected=probe.address().port;probe.close(err=>err?reject(err):resolve(selected))})})}
function startServer(selectedPort,statsPath,onOutput,onExit){const processChild=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(selectedPort),STATS_FILE:statsPath,DATABASE_URL:'',DATABASE_MODE:'sqlite',SQLITE_FILE:sqliteFile},stdio:['ignore','pipe','pipe']});processChild.stdout.on('data',x=>onOutput(x));processChild.stderr.on('data',x=>onOutput(x));processChild.on('exit',(code,signal)=>onExit?.({code,signal}));return processChild}
async function ready() {
  for (let i=0;i<80;i++) {
    try { await new Promise((resolve,reject)=>{const req=http.get(base,res=>{res.resume();resolve()});req.on('error',reject);req.setTimeout(300,reject)}); return; }
    catch { await sleep(50); }
  }
  throw new Error('server did not start; exit: '+JSON.stringify(childExit)+'; child output: '+childOutput);
}
function identity(){return new Promise((resolve,reject)=>{const req=http.get(base+'/',res=>{res.on('end',()=>resolve(res.headers['set-cookie']?.[0]?.split(';')[0]||''));res.on('error',reject);res.resume()});req.on('error',e=>reject(new Error(e.message+'; child='+childOutput+'; exit='+JSON.stringify(childExit))))})}
function getJson(route,cookie){return getJsonAt(base,route,cookie)}
function getJsonAt(host,route,cookie){return new Promise((resolve,reject)=>http.get(host+route,{headers:cookie?{Cookie:cookie}:{}},res=>{let data='';res.setEncoding('utf8');res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}))}).on('error',reject))}
function sendJson(route,cookie,body){return new Promise((resolve,reject)=>{const data=JSON.stringify(body),req=http.request(base+route,{method:'PUT',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...(cookie?{Cookie:cookie}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}))});req.on('error',reject);req.end(data);})}
async function readyAt(p){for(let i=0;i<80;i++){try{await new Promise((resolve,reject)=>{const req=http.get('http://127.0.0.1:'+p,res=>{res.resume();resolve()});req.on('error',reject);req.setTimeout(300,reject)});return}catch{await sleep(50)}}throw new Error('restarted server failed: '+restartOutput)}
function connect(code,cookie='',fighter=0) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:'+port,cookie?{headers:{Cookie:cookie}}:{});
    clients.add(ws);
    const messages=[];
    const originalSend=ws.send.bind(ws);let inputSequence=0,commandNonce=null;
    ws.send=(raw,...args)=>{try{const packet=JSON.parse(raw.toString());if(['input','attack','rematch'].includes(packet.type)){if(commandNonce&&!packet.nonce)packet.nonce=commandNonce;if(Number.isSafeInteger(packet.seq))inputSequence=Math.max(inputSequence,packet.seq);else packet.seq=++inputSequence;raw=JSON.stringify(packet);}}catch{}return originalSend(raw,...args);};
    ws.on('message',raw=>{try{const packet=JSON.parse(raw.toString());if(packet.type==='joined')commandNonce=packet.commandNonce;messages.push(packet);}catch{}});
    ws.once('open',()=>{ws.send(JSON.stringify({type:'join',code,arena:'sunset',fighter}));resolve({ws,messages,sendRaw:originalSend})});
    ws.once('error',reject);
  });
}
function waitFor(client,predicate,timeout=5000,from=0) {
  return new Promise((resolve,reject)=>{
    const start=Date.now();
    const poll=setInterval(()=>{
      const found=client.messages.slice(from).find(predicate);
      if(found){clearInterval(poll);resolve(found)}
      else if(Date.now()-start>timeout){clearInterval(poll);reject(new Error('timed out waiting for server event; received: '+client.messages.map(m=>m.type+(m.kind?':'+m.kind:'')).join(', ')+'; last players='+JSON.stringify(client.messages.filter(m=>m.type==='snapshot').at(-1)?.players)))}
    },15);
  });
}
(async()=>{
  try {
    port=await reservePort();base='http://127.0.0.1:'+port;statsFile=path.join(os.tmpdir(),'gf-stats-'+process.pid+'-'+port+'.json');sqliteFile=path.join(os.tmpdir(),'gf-stats-'+process.pid+'-'+port+'.sqlite');child=startServer(port,statsFile,x=>childOutput+=x,x=>childExit=x);
    await ready();
    const health=await getJson('/health');assert.equal(health.status,200,'health endpoint must verify persistent storage readiness');assert.equal(health.body.statsReady,true,'persistent stats storage must be writable');assert.equal(health.body.storage,'sqlite','integration server must exercise the production SQLite adapter');
    const cookie1=await identity(),cookie2=await identity();
    assert.match(cookie1,/^gf_player=/,'server must issue a persistent player identity');
    assert.match(cookie2,/^gf_player=/,'second player must receive an independent identity');
    assert.notEqual(cookie1,cookie2,'each player must have a unique identity');
    const profile=await getJson('/api/profile',cookie1);
    assert.equal(profile.status,200,'profile endpoint must work with persistent stats storage');
    assert.equal(profile.body.matches,0,'new player must start with empty statistics');
    const board=await getJson('/api/leaderboard',cookie1);
    assert.equal(board.status,200,'leaderboard endpoint must be backed by the stats store');
    assert.deepEqual(board.body.players,[],'empty stats store must have an empty leaderboard');
    const settings=await getJson('/api/settings',cookie1);
    assert.equal(settings.status,200,'player settings endpoint must be available');
    const savedSettings=await sendJson('/api/settings',cookie1,{musicVolume:.4,effectsVolume:.6,voiceVolume:.2,soundOn:false,voiceOn:true,unexpected:'discard'});
    assert.equal(savedSettings.status,200,'player settings must accept validated updates');
    const persistedSettings=await getJson('/api/settings',cookie1);
    assert.deepEqual(persistedSettings.body.settings,{musicVolume:.4,effectsVolume:.6,voiceVolume:.2,soundOn:false,voiceOn:true},'SQLite settings must persist through the HTTP API');
    const savedName=await sendJson('/api/profile',cookie1,{displayName:'Arcade One'});
    assert.equal(savedName.status,200,'guest player must be able to save a display name');
    assert.equal((await getJson('/api/profile',cookie1)).body.display_name,'Arcade One','display name must persist through the profile API');
    const history=await getJson('/api/history',cookie1);
    assert.equal(history.status,200,'match history endpoint must be available');
    assert.deepEqual(history.body.matches,[],'new player must have an empty match history');
    process.stdout.write('TEST 1: HTTP server, persistent player identity, profile and leaderboard\\n');
    const atlas=await new Promise((resolve,reject)=>http.get(base+'/fighters.svg',res=>{let data='';res.setEncoding('utf8');res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],data}))}).on('error',reject));
    assert.equal(atlas.status,200,'sprite atlas must be served');
    assert.match(atlas.type,/image\/svg\+xml/);
    assert.match(atlas.data,/<svg/);
    assert.equal((atlas.data.match(/id="p1f\d+"/g)||[]).length,17,'fighter one must have 17 distinct poses');
    assert.equal((atlas.data.match(/id="p2f\d+"/g)||[]).length,17,'fighter two must have 17 distinct poses');
    const code='T'+Math.random().toString(36).slice(2,7).toUpperCase();
    const p1=await connect(code,cookie1),p2=await connect(code,cookie2);
    await Promise.all([waitFor(p1,m=>m.type==='match-start'),waitFor(p2,m=>m.type==='match-start')]);
    p1.ws.send(JSON.stringify({type:'ping',sentAt:42}));
    const pong=await waitFor(p1,m=>m.type==='pong');
    assert.equal(pong.sentAt,42,'server must echo the client ping timestamp for RTT measurement');
    process.stdout.write('TEST 2: private room and two slots\\n');
    const no=c=>c.messages.find(m=>m.type==='joined')?.playerNo;
    const attacker=no(p1)===1?p1:p2,defender=attacker===p1?p2:p1;
    const initial=await waitFor(attacker,m=>m.type==='snapshot'&&m.players?.every(Boolean));
    const attacksBefore=attacker.messages.filter(m=>m.type==='attack-start').length;attacker.sendRaw(JSON.stringify({type:'attack',attack:{kind:'punch'}}));await sleep(50);assert.equal(attacker.messages.filter(m=>m.type==='attack-start').length,attacksBefore,'server must reject unsequenced attack commands');
    attacker.ws.send(JSON.stringify({type:'join',code:'REPLAY',arena:'sunset',fighter:0}));
    await waitFor(attacker,m=>m.type==='join-error');
    assert.equal(initial.players[0].x,290,'round reset must spawn player one at 290');
    assert.equal(initial.players[1].x,710,'round reset must spawn player two at 710');
    assert.equal(initial.players[0].vy,0,'grounded player one must not accumulate gravity before jumping');
    assert.equal(initial.players[1].vy,0,'grounded player two must not accumulate gravity before jumping');
    attacker.sendRaw(JSON.stringify({type:'input',input:{right:true,run:true,face:1}}));
    await sleep(75);
    let movement=attacker.messages.filter(m=>m.type==='snapshot'&&m.players?.every(Boolean)).at(-1)?.players[0];
    assert.equal(movement.inputAck,0,'server must reject unsequenced online input commands');
    assert.equal(movement.vx,0,'unsequenced input must not affect authoritative movement');
    attacker.ws.send(JSON.stringify({type:'input',seq:10,input:{right:true,run:true,face:1}}));
    await sleep(75);
    movement=attacker.messages.filter(m=>m.type==='snapshot'&&m.players?.every(Boolean)).at(-1)?.players[0];
    assert.ok(movement.vx>0,'authoritative snapshots must expose forward velocity');
    assert.equal(movement.run,true,'authoritative snapshots must expose running state');
    assert.equal(movement.inputAck,10,'server snapshots must acknowledge the latest sequenced input');
    attacker.ws.send(JSON.stringify({type:'input',seq:9,input:{left:true,face:-1}}));
    await sleep(75);
    movement=attacker.messages.filter(m=>m.type==='snapshot'&&m.players?.every(Boolean)).at(-1)?.players[0];
    assert.equal(movement.inputAck,10,'server must reject stale or replayed input sequence numbers');
    assert.ok(movement.vx>=0,'stale reverse input must not override the latest forward input');
    attacker.ws.send(JSON.stringify({type:'input',seq:11,input:{right:true,run:false,crouch:true,face:1}}));
    await sleep(75);
    movement=attacker.messages.filter(m=>m.type==='snapshot'&&m.players?.every(Boolean)).at(-1)?.players[0];
    assert.equal(movement.crouch,true,'authoritative snapshots must expose crouch state');
    attacker.ws.send(JSON.stringify({type:'input',input:{right:true,crouch:false,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:true,face:-1}}));
    await sleep(500);
    attacker.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:false,face:-1}}));
    await sleep(25);
    const airborne=waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y< -10);
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:true,right:false,face:1}}));
    await airborne;await sleep(25);
    const airPunchHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='airPunch');
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'airPunch'}}));
    const airPunch=await airPunchHit;
    assert.equal(airPunch.damage,12,'air punch must apply its own damage');process.stdout.write('TEST 3a: air punch\\n');
    const landFrom=attacker.messages.length;
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:false,face:1}}));
    await waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y===0,2500,landFrom);process.stdout.write('TEST 3b: first landing\\n');
    const airborne2=waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y< -10);
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:true,right:false,face:1}}));
    await airborne2;await sleep(25);
    const airHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='airKick');
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'airKick'}}));
    const air=await airHit;
    process.stdout.write('TEST 3: jump, air punch and air kick\\n');
    assert.equal(air.damage,15,'air kick must apply its own damage');process.stdout.write('TEST 3c: air kick\\n');
    const landFrom2=attacker.messages.length;
    attacker.ws.send(JSON.stringify({type:'input',input:{jump:false,face:1}}));
    await waitFor(attacker,m=>m.type==='snapshot'&&m.players?.[0]?.y===0,2500,landFrom2);process.stdout.write('TEST 3d: second landing\\n');
    const dodgeFrom=defender.messages.length,attackFrom=attacker.messages.length;
    defender.ws.send(JSON.stringify({type:'input',input:{dodge:true,face:-1}}));
    await sleep(25);
    const dodgeAttack=waitFor(attacker,m=>m.type==='attack-start'&&m.kind==='punch',5000,attackFrom);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    await dodgeAttack;
    await sleep(220);
    assert.equal(defender.messages.slice(dodgeFrom).some(m=>m.type==='damage'&&m.kind==='punch'),false,'dodge invulnerability must avoid the incoming punch');
    process.stdout.write('TEST 4: dodge invulnerability\\n');
    await sleep(120);
    const damage=waitFor(defender,m=>m.type==='damage'&&m.kind==='punch');
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    const hit=await damage;
    assert.equal(hit.playerNo,2,'damage must identify the second slot as victim');
    assert.equal(hit.hp,63,'air punch, air kick and regular punch must apply thirty-seven total damage');
    process.stdout.write('TEST 5: normal attack damage\\n');
    const heavyDamage=waitFor(defender,m=>m.type==='damage'&&m.kind==='heavyKick');
    await sleep(700);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
    const heavy=await heavyDamage;
    assert.equal(heavy.hp,42,'a heavy kick must apply twenty-one additional damage');
    const blockHit=waitFor(defender,m=>m.type==='damage'&&m.blocked===true);
    defender.ws.send(JSON.stringify({type:'input',input:{block:true,face:-1}}));
    await sleep(700);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'punch'}}));
    const blocked=await blockHit;
    assert.equal(blocked.blocked,true,'holding block must reduce incoming damage');
    assert.equal(blocked.damage,2,'blocked punch must deal chip damage only');
    process.stdout.write('TEST 6: guard and chip damage\\n');
    defender.ws.send(JSON.stringify({type:'input',input:{block:false,face:-1}}));
    await sleep(200);
    const counterHit=waitFor(attacker,m=>m.type==='damage'&&m.kind==='counter');
    defender.ws.send(JSON.stringify({type:'attack',attack:{kind:'counter'}}));
    const counter=await counterHit;
    assert.equal(counter.damage,18,'a successful block must enable a counterattack');
    process.stdout.write('TEST 7: counterattack\\n');
    await sleep(200);
    attacker.ws.send(JSON.stringify({type:'input',input:{right:true,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:true,face:-1}}));
    await sleep(250);
    attacker.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));
    defender.ws.send(JSON.stringify({type:'input',input:{left:false,face:-1}}));
    await sleep(25);
    const grabHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='grab');
    const grabStart=waitFor(attacker,m=>m.type==='attack-start'&&m.kind==='grab');
    await sleep(800);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'grab'}}));
    await grabStart;
    const grabbed=await grabHit;
    assert.equal(grabbed.damage,20,'grab must bypass guard and deal throw damage');
    process.stdout.write('TEST 8: throw\\n');
    const heavyPunchHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='heavyPunch');
    await sleep(800);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyPunch'}}));
    const heavyPunch=await heavyPunchHit;
    assert.equal(heavyPunch.hp,3,'heavy punch must apply seventeen damage');
    const koHit=waitFor(defender,m=>m.type==='damage'&&m.kind==='heavyKick'&&m.hp===0);
    const roundEndA=waitFor(attacker,m=>m.type==='round-end');
    const roundEndD=waitFor(defender,m=>m.type==='round-end');
    await sleep(700);
    attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
    await koHit;
    const [roundEnd]=await Promise.all([roundEndA,roundEndD]);
    assert.equal(roundEnd.winner,0,'server must award the KO round to the attacker');
    assert.equal(roundEnd.wins[0],1,'round win must be reflected in the series score');
    assert.equal(roundEnd.champion,false,'one round must not prematurely finish best-of-three');
    process.stdout.write('TEST 9: KO and round result\\n');
    const rematchFromA=attacker.messages.length,rematchFromD=defender.messages.length;
    attacker.sendRaw(JSON.stringify({type:'rematch'}));await sleep(60);assert.equal(attacker.messages.slice(rematchFromA).some(m=>m.type==='rematch-wait'||m.type==='match-start'),false,'server must reject unsequenced rematch commands');
    attacker.ws.send(JSON.stringify({type:'rematch'}));defender.ws.send(JSON.stringify({type:'rematch'}));
    await Promise.all([waitFor(attacker,m=>m.type==='match-start'&&m.round===2,5000,rematchFromA),waitFor(defender,m=>m.type==='match-start'&&m.round===2,5000,rematchFromD)]);
    attacker.ws.send(JSON.stringify({type:'input',input:{right:true,face:1}}));defender.ws.send(JSON.stringify({type:'input',input:{left:true,face:-1}}));await sleep(300);attacker.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));defender.ws.send(JSON.stringify({type:'input',input:{left:false,face:-1}}));await sleep(25);
    let finalRoundEnd;
    for(let n=1;n<=5;n++){
      const from=defender.messages.length;
      const next=waitFor(defender,m=>m.type==='damage'&&m.kind==='heavyKick',5000,from);
      if(n===5)finalRoundEnd=waitFor(attacker,m=>m.type==='round-end'&&m.champion===true,6000);
      attacker.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
      const d=await next;
      assert.equal(d.hp,Math.max(0,100-21*n),'heavy kick damage must be consistent across the deciding round');
      if(n<5){attacker.ws.send(JSON.stringify({type:'input',input:{right:true,face:1}}));await sleep(230);attacker.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));await sleep(480)}
    }
    const champion=await finalRoundEnd;
    assert.equal(champion.winner,0,'the server must award the championship after two round wins');
    await sleep(200);
    const winnerStats=await getJson('/api/profile',cookie1),loserStats=await getJson('/api/profile',cookie2);
    assert.equal(winnerStats.body.matches,1,'completed match must persist once for the winner');
    assert.equal(winnerStats.body.wins,1,'winner statistics must be saved');
    assert.equal(winnerStats.body.knockouts,1,'winner knockout count must be saved');
    assert.equal(winnerStats.body.rating,1016,'winner must gain Elo rating after a decisive match');
    assert.equal(loserStats.body.rating,984,'loser must lose Elo rating after a decisive match');
    assert.equal(loserStats.body.matches,1,'completed match must persist once for the loser');
    assert.equal(loserStats.body.losses,1,'loser statistics must be saved');
    const rawDb=new DatabaseSync(sqliteFile);
    const winnerRow=rawDb.prepare('SELECT wins,rating FROM player_stats WHERE player_id=?').get(cookie1.slice('gf_player='.length));
    const loserRow=rawDb.prepare('SELECT losses,rating FROM player_stats WHERE player_id=?').get(cookie2.slice('gf_player='.length));
    assert.equal(winnerRow.wins,1,'winner statistics must be durably written to SQLite');
    assert.equal(loserRow.losses,1,'loser statistics must be durably written to SQLite');
    assert.equal(rawDb.prepare('SELECT COUNT(*) AS count FROM match_history').get().count,1,'the completed match must be stored in relational history');
    rawDb.close();
    const savedHistory=await getJson('/api/history',cookie1);
    assert.equal(savedHistory.body.matches.length,1,'player history API must return the completed match');
    const restartPort=await reservePort();restartChild=startServer(restartPort,statsFile,x=>restartOutput+=x);await readyAt(restartPort);
    const reloaded=await getJsonAt('http://127.0.0.1:'+restartPort,'/api/profile',cookie1);
    assert.equal(reloaded.status,200,'profile API must be available after process restart');
    assert.equal(reloaded.body.wins,1,'statistics must reload from persistent storage after restart');
    assert.equal(reloaded.body.display_name,'Arcade One','guest display name must survive process restart');
    const ranked=await getJson('/api/leaderboard',cookie1);
    assert.equal(ranked.body.players.length,2,'leaderboard must include both players after the match');
    process.stdout.write('TEST 10: best-of-three result, durable stats and process restart\\n');
    const third=await connect(code);
    await waitFor(third,m=>m.type==='room-full');
    const otherCode='X'+Math.random().toString(36).slice(2,7).toUpperCase();
    const cookie3=await identity(),cookie4=await identity();
    const p3=await connect(otherCode,cookie3),p4=await connect(otherCode,cookie4);
    await Promise.all([waitFor(p3,m=>m.type==='match-start'),waitFor(p4,m=>m.type==='match-start')]);
    p3.ws.send(JSON.stringify({type:'input',input:{right:true,face:1}}));p4.ws.send(JSON.stringify({type:'input',input:{left:true,face:-1}}));await sleep(300);p3.ws.send(JSON.stringify({type:'input',input:{right:false,face:1}}));p4.ws.send(JSON.stringify({type:'input',input:{left:false,face:-1}}));await sleep(25);
    p4.ws.send(JSON.stringify({type:'input',input:{block:true,face:-1}}));await sleep(25);
    for(let n=0;n<5;n++){
      const from=p4.messages.length,blockedKick=waitFor(p4,m=>m.type==='damage'&&m.kind==='heavyKick'&&m.blocked===true,5000,from);
      p3.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyKick'}}));
      const d=await blockedKick;assert.equal(d.blocked,true,'guarded heavy kicks must be blocked');
      if(n<4)await sleep(700);
    }
    assert.equal(p3.messages.filter(m=>m.type==='damage'&&m.kind==='heavyKick').at(-1)?.power,100,'blocked attacks must charge the special meter');
    p4.ws.send(JSON.stringify({type:'input',input:{block:false,face:-1}}));await sleep(25);
    const specialHit=waitFor(p4,m=>m.type==='damage'&&m.kind==='special');
    await sleep(800);p3.ws.send(JSON.stringify({type:'attack',attack:{kind:'special'}}));
    const special=await specialHit;assert.equal(special.damage,25,'full meter must unlock the server-validated special attack');
    const beforeDrop=p3.messages.filter(m=>m.type==='snapshot').at(-1)?.players?.[0]?.x;
    assert.ok(beforeDrop>290,'active room movement must be present before disconnect');
    p4.ws.close();await waitFor(p3,m=>m.type==='opponent-left');
    const intruder=await connect(otherCode,await identity());
    await waitFor(intruder,m=>m.type==='room-reserved');
    const p4Again=await connect(otherCode,cookie4);
    const [resume3,resume4]=await Promise.all([waitFor(p3,m=>m.type==='match-resumed'&&m.status==='playing'),waitFor(p4Again,m=>m.type==='match-resumed'&&m.status==='playing')]);
    assert.equal(resume3.round,1,'reconnected match must keep its current round');
    await sleep(60);
    const afterResume=p3.messages.filter(m=>m.type==='snapshot').at(-1)?.players?.[0]?.x;
    assert.ok(afterResume>290,'server must preserve the active player position across reconnect');
    defender.ws.close();await waitFor(attacker,m=>m.type==='opponent-left');
    const rejoin=await connect(code,cookie2);
    const [roundResumeA,roundResumeD]=await Promise.all([waitFor(attacker,m=>m.type==='match-resumed'&&m.status==='round-over'),waitFor(rejoin,m=>m.type==='match-resumed'&&m.status==='round-over')]);
    assert.equal(roundResumeA.wins[0],2,'completed championship score must survive reconnect');
    assert.equal(roundResumeD.round,2,'completed round number must survive reconnect');
    process.stdout.write('TEST 11: reconnect and isolated rooms\\n');
    attacker.ws.close();rejoin.ws.close();third.ws.close();p3.ws.close();p4.ws.close();p4Again.ws.close();intruder.ws.close();
    const balanceCode='B'+Math.random().toString(36).slice(2,7).toUpperCase();
    const dojo=await connect(balanceCode,await identity(),1),glavat=await connect(balanceCode,await identity(),0);
    await Promise.all([waitFor(dojo,m=>m.type==='match-start'),waitFor(glavat,m=>m.type==='match-start')]);
    const dojoNo=dojo.messages.find(m=>m.type==='joined')?.playerNo;
    const dojoSlot=dojoNo-1,glavatSlot=1-dojoSlot;
    const firstSnapshot=await waitFor(dojo,m=>m.type==='snapshot'&&m.players?.every(Boolean));
    assert.equal(firstSnapshot.players[dojoSlot].fighter,1,'DOJO fighter identity must be present in authoritative snapshots');
    assert.equal(firstSnapshot.players[glavatSlot].fighter,0,'GLAVAT fighter identity must be present in authoritative snapshots');
    dojo.ws.send(JSON.stringify({type:'input',input:{right:true,run:true,face:1}}));
    glavat.ws.send(JSON.stringify({type:'input',input:{left:true,run:true,face:-1}}));
    await sleep(420);
    dojo.ws.send(JSON.stringify({type:'input',input:{right:false,run:false,face:1}}));
    glavat.ws.send(JSON.stringify({type:'input',input:{left:false,run:false,face:-1}}));
    await sleep(80);
    await waitFor(dojo,m=>m.type==='snapshot'&&m.players?.every(Boolean)&&Math.abs(m.players[1].x-m.players[0].x)<340,3000);
    await sleep(40);
    const heavyFrom=glavat.messages.length;
    const dojoAttack=waitFor(glavat,m=>m.type==='attack-start'&&m.kind==='heavyPunch',5000,heavyFrom);
    const dojoDamage=waitFor(glavat,m=>m.type==='damage'&&m.kind==='heavyPunch',5000,heavyFrom);
    dojo.ws.send(JSON.stringify({type:'attack',attack:{kind:'heavyPunch'}}));
    const [attackStart,profileHit]=await Promise.all([dojoAttack,dojoDamage]);
    assert.equal(profileHit.damage,19,'DOJO heavy punch must apply its 12% fighter-specific damage bonus');
    assert.equal(attackStart.duration,Math.round(attackStart.windup/.42),'online attack animation duration must align its active frame with server hit time');
    assert.equal(attackStart.activeIn,attackStart.windup,'server must publish the authoritative active-frame timing');
    dojo.ws.close();glavat.ws.close();
    process.stdout.write('TEST 12: distinct fighter profiles and online active-frame timing\\n');
    process.stdout.write('Online combat, jump, air punch/kick, special, heavy punch/kick, dodge, guard, counter, grab, KO, round result, room capacity, isolation, same-player reconnect, reserved slots, persistent stats and room isolation tests passed.\\n');
  } finally {
    for(const ws of clients){try{ws.terminate()}catch{}}
    child.kill('SIGTERM');
    if(restartChild)restartChild.kill('SIGTERM');
  }
})().catch(err=>{console.error(err);process.exitCode=1});
