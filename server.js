'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const STATS_FILE=process.env.STATS_FILE||path.join(__dirname,'data','fighter-stats.json');
let statsData={},statsQueue=Promise.resolve();
function initStats(){
  fs.mkdirSync(path.dirname(STATS_FILE),{recursive:true});
  try{const parsed=JSON.parse(fs.readFileSync(STATS_FILE,'utf8'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))statsData=parsed;}
  catch(e){if(e.code!=='ENOENT')throw e;fs.writeFileSync(STATS_FILE,'{}',{mode:0o600});}
  return true;
}
let dbReady=Promise.resolve().then(initStats).catch(e=>{console.error('stats database init failed',e.message);return false;});
function persistStats(){
  const snapshot=JSON.stringify(statsData),tmp=STATS_FILE+'.tmp';
  statsQueue=statsQueue.then(()=>fs.promises.writeFile(tmp,snapshot,{mode:0o600})).then(()=>fs.promises.rename(tmp,STATS_FILE));
  return statsQueue;
}
const emptyStats=()=>({matches:0,wins:0,losses:0,draws:0,knockouts:0,win_streak:0,best_streak:0,favorite_fighter:0,fighter_0_count:0,fighter_1_count:0});
async function profile(id,res){
  if(!await dbReady)return json(res,503,{error:'Statistics database unavailable'});
  const x=statsData[id]||emptyStats();
  json(res,200,{...x,winRate:x.matches?Math.round(x.wins/x.matches*100):0});
}
async function leaderboard(res){
  if(!await dbReady)return json(res,503,{error:'Statistics database unavailable'});
  const players=Object.entries(statsData).map(([id,x])=>({player_id:id.slice(0,8),...x,win_rate:x.matches?Math.round(x.wins/x.matches*100):0}))
    .filter(x=>x.matches>0).sort((a,b)=>b.wins-a.wins||b.best_streak-a.best_streak||b.matches-a.matches).slice(0,50);
  json(res,200,{players});
}

function readPlayerId(cookie=''){const m=String(cookie).match(/(?:^|;\s*)gf_player=([0-9a-f-]{36})(?:;|$)/i);return m?m[1]:null;}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const MAX_ROOMS = 2000, MAX_CLIENTS = 4000, ROOM_TTL = 90_000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const now = () => Date.now();
// GLAVAT is agile; DOJO trades speed for reach, guard and impact.
const FIGHTER_BALANCE = Object.freeze([
  Object.freeze({speed:1,damage:1,reach:1,recovery:1,guard:.18}),
  Object.freeze({speed:.92,damage:1.12,reach:1.08,recovery:1.12,guard:.14})
]);
const fighterStats = id => FIGHTER_BALANCE[id===1?1:0];

const server = http.createServer((req, res) => {
  let playerId=readPlayerId(req.headers.cookie||'');
  if(!playerId){playerId=crypto.randomUUID();res.setHeader('Set-Cookie',`gf_player=${playerId}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`);}
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if(pathname==='/health'&&req.method==='GET')return dbReady.then(ready=>json(res,ready?200:503,{ok:ready,statsReady:ready}));
  if(pathname==='/api/profile'&&req.method==='GET')return profile(playerId,res);
  if(pathname==='/api/leaderboard'&&req.method==='GET')return leaderboard(res);
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
function playerState(x, dir, fighter=0) { return { x, y:0, vx:0, vy:0, dir, fighter:fighter===1?1:0, hp:100, power:0, block:false, input:{left:false,right:false,jump:false,dodge:false},jumpLatch:false,dodgeUntil:0,lastDodge:0,counterReadyUntil:0,attack:0,stun:0,invuln:0,lastAttack:0,lastStateAt:now(),lastPhysicsAt:now(),attackToken:null }; }
function publicPlayer(p) { return { x:p.x, y:p.y, vx:p.vx, vy:p.vy, dir:p.dir, fighter:p.fighter, hp:p.hp, power:p.power, block:p.block, attack:p.attack, stun:p.stun, invuln:p.invuln, run:p.input.run, crouch:p.input.crouch }; }
function snapshot(room) {
  return { type:'snapshot', room:room.code, status:room.status, round:room.round, wins:room.wins.slice(), timer:room.timer,
    players:room.slots.map(s => s ? publicPlayer(s.state) : null) };
}
function broadcast(room, data) { room.slots.forEach(s => { if (s) send(s.ws, data); }); }
function snapshotAll(room) { broadcast(room, snapshot(room)); }
function roomFor(code) { return rooms.get(code); }
function closeRoomIfEmpty(room) { if (room.slots.every(s => !s)) { room.gcAt=now()+ROOM_TTL; room.status='empty'; } }
function resetRound(room) {
  room.timer=99; room.roundStarted=now(); room.status='playing'; room.lastResult=null;
  room.slots.forEach((s,i)=>{ if(s) s.state=playerState(i===0?290:710, i===0?1:-1,s.fighter); });
  broadcast(room,{type:'round-start',round:room.round,wins:room.wins.slice(),timer:99});
  snapshotAll(room);
}
function saveMatch(room,winner,reason){
 if(room.statsSaved)return Promise.resolve();room.statsSaved=true;
 return dbReady.then(async ready=>{if(!ready)throw new Error('stats store is not ready');for(let i=0;i<2;i++){const slot=room.slots[i];if(!slot||!slot.playerId)continue;
  const won=winner===i,draw=winner===null,ko=reason==='ko'&&won,x=statsData[slot.playerId]||emptyStats();
  x.matches++;if(won){x.wins++;x.win_streak++;x.knockouts+=ko?1:0;}else if(draw){x.draws++;x.win_streak=0;}else{x.losses++;x.win_streak=0;}
  x.best_streak=Math.max(x.best_streak,x.win_streak);
  if(slot.fighter===0)x.fighter_0_count++;else x.fighter_1_count++;
  x.favorite_fighter=x.fighter_0_count>=x.fighter_1_count?0:1;
  statsData[slot.playerId]=x;
 }}).then(()=>persistStats()).catch(e=>console.error('stats save failed',e.message));
}
async function endRound(room, winner, reason) {
  if(room.status!=='playing') return;
  room.status='saving';
  if(winner===0||winner===1) room.wins[winner]++;
  const champion=room.wins.some(v=>v>=2)||(winner===null&&room.round>=3);
  room.matchComplete=champion;
  room.lastResult={winner,reason,round:room.round,wins:room.wins.slice(),champion};
  if(champion)await saveMatch(room,winner,reason);
  room.status='round-over';
  broadcast(room,{type:'round-end',...room.lastResult});
  snapshotAll(room);
}
function leave(ws) {
  const room=ws.room;
  if(!room) return;
  ws.room=null;
  const idx=room.slots.findIndex(s=>s && s.ws===ws);
  if(idx<0) return;
  const slot=room.slots[idx];
  slot.ws=null;slot.disconnectedAt=now();
  if(room.status!=='waiting')room.resumeStatus=room.status==='saving'?'round-over':room.status;
  room.status='waiting';
  room.rematchVotes.clear();
  broadcast(room,{type:'opponent-left',playerNo:idx+1});
  if(room.slots.every(s=>s&&!s.ws))room.gcAt=now()+ROOM_TTL;
}
function valid(n,lo,hi){return typeof n==='number'&&Number.isFinite(n)&&n>=lo&&n<=hi;}
function join(ws,msg) {
  const code=String(msg.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  if(code.length<3) return send(ws,{type:'join-error',message:'Код комнаты — минимум 3 символа.'});
  let room=roomFor(code);
  if(!room){
    if(rooms.size>=MAX_ROOMS) return send(ws,{type:'server-full',message:'Сервер комнат временно заполнен.'});
    room={code,slots:[null,null],status:'waiting',resumeStatus:'waiting',lastResult:null,round:1,wins:[0,0],timer:99,statsSaved:false,matchComplete:false,arena:['sunset','night','dojo','underground','neon'].includes(msg.arena)?msg.arena:'sunset',rematchVotes:new Set(),gcAt:0};
    rooms.set(code,room);
  }
  const playerId=readPlayerId(ws._cookie||'');
  let idx=playerId?room.slots.findIndex(s=>s&&!s.ws&&s.playerId===playerId&&s.disconnectedAt&&now()-s.disconnectedAt<ROOM_TTL):-1;
  const reconnect=idx>=0;
  if(!reconnect){
    const reserved=room.slots.some(s=>s&&!s.ws&&s.disconnectedAt&&now()-s.disconnectedAt<ROOM_TTL);
    if(reserved)return send(ws,{type:'room-reserved',message:'Место временно зарезервировано за отключившимся игроком.'});
    idx=room.slots.findIndex(s=>!s);
    if(idx<0)return send(ws,{type:'room-full',message:'В комнате уже два игрока.'});
    room.slots[idx]={ws,playerId,state:playerState(idx===0?290:710,idx===0?1:-1,msg.fighter===1?1:0),fighter:msg.fighter===1?1:0,disconnectedAt:0};
  }else{
    room.slots[idx].ws=ws;room.slots[idx].disconnectedAt=0;
  }
  room.gcAt=0;
  ws.room=room;ws.playerNo=idx+1;ws.lastMsg=0;
  send(ws,{type:'joined',code,playerNo:idx+1,count:room.slots.filter(s=>s&&s.ws).length,arena:room.arena,reconnected:reconnect});
  if(room.slots.every(s=>s&&s.ws)){
    if(reconnect&&room.resumeStatus==='playing'&&!room.matchComplete){
      room.status='playing';room.roundStarted=now()-(99-room.timer)*1000;room.lastSnapshot=0;
      broadcast(room,{type:'match-resumed',status:'playing',arena:room.arena,round:room.round,wins:room.wins.slice(),fighters:room.slots.map(s=>s.fighter),timer:room.timer});
      snapshotAll(room);
    }else if(reconnect&&room.resumeStatus==='round-over'&&room.lastResult){
      room.status='round-over';
      broadcast(room,{type:'match-resumed',status:'round-over',arena:room.arena,round:room.round,wins:room.wins.slice(),fighters:room.slots.map(s=>s.fighter),timer:room.timer});
      snapshotAll(room);broadcast(room,{type:'round-end',...room.lastResult});
    }else{
      room.wins=[0,0];room.round=1;room.matchComplete=false;room.statsSaved=false;room.resumeStatus='playing';room.rematchVotes.clear();resetRound(room);
      broadcast(room,{type:'match-start',arena:room.arena,round:1,wins:[0,0],fighters:room.slots.map(s=>s.fighter)});
    }
  }
}
function handle(ws,msg){
  if(!msg||typeof msg!=='object') return;
  if(msg.type==='join') return join(ws,msg);
  const room=ws.room;
  if(!room) return;
  const idx=ws.playerNo-1, slot=room.slots[idx], other=room.slots[1-idx];
  if(!slot||slot.ws!==ws) return;
  if(msg.type==='input' && room.status==='playing'){
    const v=msg.input||{},p=slot.state;
    p.input={left:!!v.left,right:!!v.right,jump:!!v.jump,dodge:!!v.dodge,run:!!v.run,crouch:!!v.crouch,block:!!v.block};if(v.face===-1||v.face===1)p.dir=v.face;
    if(p.stun<=0)p.block=p.input.block;
    if(p.input.jump&&!p.jumpLatch&&p.y===0&&p.stun<=0)p.vy=-9.5;
    p.jumpLatch=p.input.jump;
    if(p.input.dodge&&p.lastDodge+850<=now()&&p.stun<=0){p.lastDodge=now();p.dodgeUntil=now()+230;p.invuln=now()+190;}
    return;
  }
  if(msg.type==='attack' && room.status==='playing' && other){
    const kind=msg.attack&&msg.attack.kind;
    if(!['punch','kick','special','heavyPunch','heavyKick','grab','airPunch','airKick','counter'].includes(kind)) return;
    const nowAt=now(),a=slot.state,v=other.state;
    const cooldown=Math.round((kind==='special'?1000:kind==='grab'?700:kind==='counter'?720:kind.startsWith('heavy')?680:kind==='kick'||kind==='airKick'?420:300)*fighterStats(a.fighter).recovery);
    if(nowAt-a.lastAttack<cooldown||a.stun>0) return;
    if((kind==='airPunch'||kind==='airKick')&&a.y>-10)return;
    if(kind==='grab'&&a.y<-10)return;
    if(kind==='special'&&a.power<100) return;
    if(kind==='counter'&&a.counterReadyUntil<nowAt) return;
    const dx=v.x-a.x,dy=Math.abs(v.y-a.y),range=Math.round((kind==='special'?430:kind==='grab'?340:kind==='counter'?300:kind==='heavyKick'?360:kind==='heavyPunch'?320:kind==='kick'||kind==='airKick'?310:kind==='airPunch'?280:260)*fighterStats(a.fighter).reach);
    if(Math.sign(dx)!==a.dir||Math.abs(dx)>range+35||dy>75) return;
    a.lastAttack=nowAt;
    if(kind==='special')a.power=0;
    const token=crypto.randomUUID();
    a.attackToken=token;
    const windup=kind==='special'?300:kind==='grab'?180:kind==='counter'?85:kind==='airPunch'||kind==='airKick'?110:kind.startsWith('heavy')?250:kind==='kick'?175:130;
    broadcast(room,{type:'attack-start',playerNo:idx+1,kind,windup,activeIn:windup,duration:Math.round(windup/.42)});
    setTimeout(()=>{
      if(room.status!=='playing'||room.round!==roundAtAttack||a.attackToken!==token||!room.slots[idx]||!room.slots[1-idx])return;
      const currentA=room.slots[idx].state,currentV=room.slots[1-idx].state;
      const hitDx=currentV.x-currentA.x,hitDy=Math.abs(currentV.y-currentA.y);
      if(Math.sign(hitDx)!==currentA.dir||Math.abs(hitDx)>range||hitDy>((kind==='airPunch'||kind==='airKick')?115:58)||currentV.invuln>now())return;
      const blocked=kind!=='grab'&&currentV.block&&Math.sign(hitDx)===-currentV.dir;
      const baseDamage=kind==='special'?25:kind==='grab'?20:kind==='counter'?18:kind==='heavyKick'?21:kind==='heavyPunch'?17:kind==='kick'||kind==='airKick'?15:kind==='airPunch'?12:10;
      const scaledDamage=Math.round(baseDamage*fighterStats(currentA.fighter).damage);
      const damage=blocked?Math.max(1,Math.round(scaledDamage*fighterStats(currentV.fighter).guard)):scaledDamage;
      currentV.hp=clamp(currentV.hp-damage,0,100);if(!blocked){currentV.attackToken=null;currentV.block=false;}else currentV.counterReadyUntil=now()+650;currentA.counterReadyUntil=kind==='counter'?0:currentA.counterReadyUntil;currentV.stun=blocked?70:kind==='grab'?440:kind==='special'||kind==='heavyKick'?350:kind==='heavyPunch'?270:kind==='kick'||kind==='airKick'?220:160;currentV.invuln=now()+(blocked?120:280);
      currentV.x=clamp(currentV.x+currentA.dir*(blocked?8:kind==='grab'?58:kind==='special'?48:kind==='heavyKick'?38:kind==='heavyPunch'?30:kind==='kick'||kind==='airKick'?26:18)*(currentV.fighter===1?.88:1),70,930);
      currentA.power=clamp(currentA.power+(kind==='special'?0:kind==='grab'?20:kind==='heavyKick'?23:kind==='heavyPunch'?20:kind==='kick'||kind==='airKick'?17:12),0,100);
      broadcast(room,{type:'damage',playerNo:2-idx,hp:currentV.hp,damage,kind,attackerNo:idx+1,blocked,power:currentA.power});
      snapshotAll(room);
      if(currentV.hp<=0)endRound(room,idx,'ko');
    },windup);
    const roundAtAttack=room.round;
    return;
  }
  if(msg.type==='rematch'&&room.status==='round-over'){
    room.rematchVotes.add(idx);
    if(room.rematchVotes.size===2){
      room.rematchVotes.clear();
      if(room.matchComplete||room.wins.some(v=>v>=2)){room.wins=[0,0];room.round=1;room.statsSaved=false;room.matchComplete=false;}
      else room.round++;
      resetRound(room);broadcast(room,{type:'match-start',arena:room.arena,round:room.round,wins:room.wins.slice(),fighters:room.slots.map(s=>s.fighter)});
    }else send(ws,{type:'rematch-wait'});
  }
}
wss.on('connection',(ws,req)=>{ws._cookie=req.headers.cookie||'';
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
const physicsTick=setInterval(()=>{
 const t=now();
 for(const room of rooms.values()){
  if(room.status!=='playing'||!room.slots.every(Boolean))continue;
  for(let i=0;i<2;i++){const p=room.slots[i].state,dt=clamp(t-p.lastPhysicsAt,0,50);p.lastPhysicsAt=t;
   p.stun=Math.max(0,p.stun-dt);if(p.invuln<=t)p.invuln=0;
   if(p.stun<=0){const move=(p.input.right?1:0)-(p.input.left?1:0);if(move)p.dir=move;p.vx=(p.dodgeUntil>t?p.dir*.37:move*(p.input.crouch?.06:p.input.run?.282:.186))*fighterStats(p.fighter).speed;p.block=!!p.input.block;}else p.block=false;
   p.x=clamp(p.x+p.vx*dt,70,930);p.vx*=Math.pow(.78,dt/16.67);
   p.y+=p.vy*dt/16.67;p.vy+=.48*dt/16.67;if(p.y>0){p.y=0;p.vy=0;}
  }
  const a=room.slots[0].state,b=room.slots[1].state;
  if(Math.abs(a.x-b.x)<68){const mid=(a.x+b.x)/2;a.x=clamp(mid-34,70,896);b.x=clamp(mid+34,104,930);}
  if(t-(room.lastSnapshot||0)>50){room.lastSnapshot=t;snapshotAll(room);}
 }
},33);
const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue}ws.isAlive=false;ws.ping()}},25000);
const roomClock=setInterval(()=>{
  const t=now();
  for(const [code,room] of rooms){
    for(let i=0;i<2;i++){const slot=room.slots[i];if(slot&&!slot.ws&&slot.disconnectedAt&&t-slot.disconnectedAt>=ROOM_TTL)room.slots[i]=null;}
    if(room.slots.every(s=>!s)){rooms.delete(code);continue}
    if(room.gcAt&&room.gcAt<t){rooms.delete(code);continue}
    if(room.status==='playing'&&room.slots.every(Boolean)){
      const left=Math.max(0,99-Math.floor((t-room.roundStarted)/1000));
      if(left!==room.timer){room.timer=left;broadcast(room,{type:'timer',timer:left})}
      if(left===0){const a=room.slots[0].state.hp,b=room.slots[1].state.hp;endRound(room,a===b?null:a>b?0:1,'time')}
    }
  }
},200);
wss.on('close',()=>{clearInterval(heartbeat);clearInterval(roomClock);clearInterval(physicsTick)});
server.listen(PORT,'0.0.0.0',()=>console.log('GLAVAT FIGHTERS server listening on '+PORT));
