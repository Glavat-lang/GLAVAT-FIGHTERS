'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const MAX_ROOMS = 2000, MAX_CLIENTS = 4000, ROOM_TTL = 90_000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const now = () => Date.now();

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const full = path.resolve(PUBLIC, relative);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml' };
    res.writeHead(200, { 'Content-Type':types[path.extname(full)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') return res.end();
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 2048, perMessageDeflate:false });
function send(ws, data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function playerState(x, dir) { return { x, y:0, dir, hp:100, power:0, block:false, attack:0, stun:0, invuln:0, lastAttack:0, attackToken:null }; }
function publicPlayer(p) { return { x:p.x, y:p.y, dir:p.dir, hp:p.hp, power:p.power, block:p.block, attack:p.attack, stun:p.stun }; }
function snapshot(room) {
  return { type:'snapshot', room:room.code, status:room.status, round:room.round, wins:room.wins.slice(), timer:room.timer,
    players:room.slots.map(s => s ? publicPlayer(s.state) : null) };
}
function broadcast(room, data) { room.slots.forEach(s => { if (s) send(s.ws, data); }); }
function snapshotAll(room) { broadcast(room, snapshot(room)); }
function roomFor(code) { return rooms.get(code); }
function closeRoomIfEmpty(room) { if (room.slots.every(s => !s)) { room.gcAt=now()+ROOM_TTL; room.status='empty'; } }
function resetRound(room) {
  room.timer=99; room.roundStarted=now(); room.status='playing';
  room.slots.forEach((s,i)=>{ if(s) s.state=playerState(i===0?0.29:0.71, i===0?1:-1); });
  broadcast(room,{type:'round-start',round:room.round,wins:room.wins.slice(),timer:99});
  snapshotAll(room);
}
function endRound(room, winner, reason) {
  if(room.status!=='playing') return;
  room.status='round-over';
  if(winner===0||winner===1) room.wins[winner]++;
  broadcast(room,{type:'round-end',winner,reason,round:room.round,wins:room.wins.slice(),champion:room.wins.some(v=>v>=2)});
  snapshotAll(room);
}
function leave(ws) {
  const room=ws.room;
  if(!room) return;
  ws.room=null;
  const idx=room.slots.findIndex(s=>s && s.ws===ws);
  if(idx<0) return;
  room.slots[idx]=null;
  room.status='waiting';
  room.rematchVotes.clear();
  broadcast(room,{type:'opponent-left',playerNo:idx+1});
  if(room.slots.every(s=>!s)) closeRoomIfEmpty(room);
}
function valid(n,lo,hi){return typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;}
function join(ws,msg) {
  leave(ws);
  const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  if(code.length<3) return send(ws,{type:'join-error',message:'Код комнаты — минимум 3 символа.'});
  let room=roomFor(code);
  if(!room){
    if(rooms.size>=MAX_ROOMS) return send(ws,{type:'server-full',message:'Сервер комнат временно заполнен.'});
    room={code,slots:[null,null],status:'waiting',round:1,wins:[0,0],timer:99,arena:['sunset','night','dojo','underground','neon'].includes(msg.arena)?msg.arena:'sunset',rematchVotes:new Set(),gcAt:0};
    rooms.set(code,room);
  }
  if(room.slots.every(Boolean)) return send(ws,{type:'room-full',message:'В комнате уже два игрока.'});
  const idx=room.slots.findIndex(s=>!s);
  room.gcAt=0; room.slots[idx]={ws,state:playerState(idx===0?0.29:0.71,idx===0?1:-1)};
  ws.room=room; ws.playerNo=idx+1; ws.lastMsg=0;
  send(ws,{type:'joined',code,playerNo:idx+1,count:room.slots.filter(Boolean).length,arena:room.arena});
  if(room.slots.every(Boolean)){
    room.wins=[0,0];room.round=1;room.rematchVotes.clear();resetRound(room);
    broadcast(room,{type:'match-start',arena:room.arena,round:1,wins:[0,0]});
  }
}
function handle(ws,msg){
  if(!msg||typeof msg!=='object') return;
  if(msg.type==='join') return join(ws,msg);
  const room=ws.room;
  if(!room) return;
  const idx=ws.playerNo-1, slot=room.slots[idx], other=room.slots[1-idx];
  if(!slot||slot.ws!==ws) return;
  if(msg.type==='state' && room.status==='playing'){
    const s=msg.state||{};
    if(!valid(s.x,0,10000)||!valid(s.y,-1000,0)) return;
    const p=slot.state;
    // Client supplies intent/pose only. Health, power, stun and hit results stay server-owned.
    p.x=clamp(s.x,20,980);p.y=clamp(s.y,-260,0);p.dir=s.dir===-1?-1:1;
    p.block=!!s.block&&p.stun<=0;p.attack=valid(s.attack,0,30)?s.attack:0;
    p.stun=Math.max(0,p.stun-1);
    if(other) send(other.ws,{type:'opponent-state',playerNo:idx+1,state:publicPlayer(p)});
    return;
  }
  if(msg.type==='attack' && room.status==='playing' && other){
    const kind=msg.attack&&msg.attack.kind;
    if(!['punch','kick','special','heavyPunch','heavyKick'].includes(kind)) return;
    const nowAt=now(),a=slot.state,v=other.state;
    const cooldown=kind==='special'?850:kind.startsWith('heavy')?620:kind==='kick'?380:260;
    if(nowAt-a.lastAttack<cooldown||a.stun>0) return;
    if(kind==='special'&&a.power<100) return;
    const dx=v.x-a.x,dy=Math.abs(v.y-a.y),range=kind==='special'?170:kind==='heavyKick'?155:kind==='heavyPunch'?132:kind==='kick'?128:104;
    if(Math.sign(dx)!==a.dir||Math.abs(dx)>range+35||dy>75) return;
    a.lastAttack=nowAt;
    if(kind==='special')a.power=0;
    const token=crypto.randomUUID();
    a.attackToken=token;
    const windup=kind==='special'?260:kind.startsWith('heavy')?235:kind==='kick'?165:115;
    broadcast(room,{type:'attack-start',playerNo:idx+1,kind,windup});
    setTimeout(()=>{
      if(room.status!=='playing'||room.round!==roundAtAttack||a.attackToken!==token||!room.slots[idx]||!room.slots[1-idx])return;
      const currentA=room.slots[idx].state,currentV=room.slots[1-idx].state;
      const hitDx=currentV.x-currentA.x,hitDy=Math.abs(currentV.y-currentA.y);
      if(Math.sign(hitDx)!==currentA.dir||Math.abs(hitDx)>range||hitDy>58||currentV.invuln>now())return;
      const blocked=currentV.block&&Math.sign(hitDx)===-currentV.dir;
      const baseDamage=kind==='special'?24:kind==='heavyKick'?21:kind==='heavyPunch'?17:kind==='kick'?15:10;
      const damage=blocked?Math.max(1,Math.round(baseDamage*.18)):baseDamage;
      currentV.hp=clamp(currentV.hp-damage,0,100);currentV.stun=blocked?5:kind==='special'?25:kind==='kick'?16:11;currentV.invuln=now()+(blocked?120:280);
      currentV.x=clamp(currentV.x+currentA.dir*(blocked?8:kind==='special'?34:kind==='kick'?20:12),20,980);
      currentA.power=clamp(currentA.power+(kind==='special'?0:kind==='heavyKick'?23:kind==='heavyPunch'?20:kind==='kick'?17:12),0,100);
      broadcast(room,{type:'damage',playerNo:2-idx,hp:currentV.hp,damage,kind,attackerNo:idx+1,blocked,power:currentA.power});
      snapshotAll(room);
      if(currentV.hp<=0)endRound(room,idx,'ko');
    },windup);
    const roundAtAttack=room.round;
    return;
  }
  if(msg.type==='rematch'){
    room.rematchVotes.add(idx);
    if(room.rematchVotes.size===2){
      room.rematchVotes.clear();
      if(room.wins.some(v=>v>=2)){room.wins=[0,0];room.round=1;}
      else room.round++;
      resetRound(room);broadcast(room,{type:'match-start',arena:room.arena,round:room.round,wins:room.wins.slice()});
    }else send(ws,{type:'rematch-wait'});
  }
}
wss.on('connection',ws=>{
  if(wss.clients.size>MAX_CLIENTS){ws.close(1013,'Server busy');return;}
  ws.isAlive=true;ws.on('pong',()=>ws.isAlive=true);
  ws.on('message',raw=>{
    if(raw.length>2048)return;
    const t=now();if(t-(ws.lastMsg||0)<12)return;ws.lastMsg=t;
    let msg;try{msg=JSON.parse(raw.toString())}catch{return}
    try{handle(ws,msg)}catch(err){console.error('socket message error',err)}
  });
  ws.on('close',()=>leave(ws));ws.on('error',()=>leave(ws));
});
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue}ws.isAlive=false;ws.ping()}},25000);
const roomClock=setInterval(()=>{
  const t=now();
  for(const [code,room] of rooms){
    if(room.gcAt&&room.gcAt<t){rooms.delete(code);continue}
    if(room.status==='playing'&&room.slots.every(Boolean)){
      const left=Math.max(0,99-Math.floor((t-room.roundStarted)/1000));
      if(left!==room.timer){room.timer=left;broadcast(room,{type:'timer',timer:left})}
      if(left===0){const a=room.slots[0].state.hp,b=room.slots[1].state.hp;endRound(room,a===b?null:a>b?0:1,'time')}
    }
  }
},200);
wss.on('close',()=>{clearInterval(heartbeat);clearInterval(roomClock)});
server.listen(PORT,'0.0.0.0',()=>console.log('GLAVAT FIGHTERS server listening on '+PORT));
