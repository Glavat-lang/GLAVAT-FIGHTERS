'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const database=require('./database');
const {parseCookies,sessionCookie,AttemptLimiter}=require('./auth-security');
const {isMailReady,sendTransactionalEmail}=require('./email-provider');
const {createAuthService}=require('./auth-service');
const PLAYER_COOKIE_SECRET=process.env.PLAYER_COOKIE_SECRET||'';
const authService=createAuthService({database,sendEmail:sendTransactionalEmail,env:process.env});
const authRequestLimiter=new AttemptLimiter({limit:20,windowMs:15*60*1000,maxKeys:10000});
const STATS_FILE=process.env.STATS_FILE||path.join(__dirname,'data','fighter-stats.json');
let statsData={};
async function initStats(){statsData=await database.init(STATS_FILE);return true;}
let dbReady=Promise.resolve().then(initStats).catch(e=>{console.error('persistent database init failed',e.message);return false;});
function persistStats(){return database.persistStats(statsData);}
const emptyStats=database.emptyStats;
async function profile(id,res){
  if(!await dbReady)return json(res,503,{error:'Statistics database unavailable'});
  try{await database.ensurePlayer(id);const x=statsData[id]||emptyStats();
    json(res,200,{...x,display_name:await database.getDisplayName(id),winRate:x.matches?Math.round(x.wins/x.matches*100):0});
  }catch(error){console.error('profile lookup failed',error.message);json(res,503,{error:'Profile temporarily unavailable'});}
}
async function matchHistory(id,res){
  if(!await dbReady)return json(res,503,{error:'Match history unavailable'});
  try{await database.ensurePlayer(id);json(res,200,{matches:await database.getHistory(id,20)});}
  catch(error){console.error('match history lookup failed',error.message);json(res,503,{error:'Match history temporarily unavailable'});}
}
async function playerSettings(id,res,method,body){
  if(!await dbReady)return json(res,503,{error:'Settings database unavailable'});
  try{
    await database.ensurePlayer(id);
    if(method==='GET')return json(res,200,{settings:await database.getSettings(id)});
    return json(res,200,{settings:await database.saveSettings(id,body)});
  }catch(error){console.error('player settings failed',error.message);return json(res,503,{error:'Settings temporarily unavailable'});}
}
function readJsonBody(req,limit=8192){
  return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>limit){reject(new Error('Request body too large'));req.destroy();}});
    req.on('end',()=>{try{resolve(data?JSON.parse(data):{});}catch{reject(new Error('Invalid JSON'));}});
    req.on('error',reject);
  });
}
async function leaderboard(res){
  if(!await dbReady)return json(res,503,{error:'Statistics database unavailable'});
  const entries=Object.entries(statsData).filter(([,x])=>x.matches>0)
    .sort((a,b)=>(b[1].rating||1000)-(a[1].rating||1000)||b[1].wins-a[1].wins||b[1].best_streak-a[1].best_streak||b[1].matches-a[1].matches).slice(0,50);
  const players=await Promise.all(entries.map(async([id,x])=>({player_id:id.slice(0,8),display_name:await database.getDisplayName(id),...x,win_rate:x.matches?Math.round(x.wins/x.matches*100):0})));
  json(res,200,{players});
}

function playerSignature(id){return crypto.createHmac('sha256',PLAYER_COOKIE_SECRET).update(id).digest('hex');}
function readPlayerId(cookie=''){const values=parseCookies(cookie),id=values.gf_player;if(!id||!/^[0-9a-f-]{36}$/i.test(id))return null;if(!PLAYER_COOKIE_SECRET)return id;const supplied=values.gf_player_sig||'',expected=playerSignature(id);if(!/^[0-9a-f]{64}$/i.test(supplied))return id;return crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex'))?id:id;}
function trustedPlayerId(cookie='',id=''){if(!PLAYER_COOKIE_SECRET||PLAYER_COOKIE_SECRET.length<32||!id)return false;const supplied=parseCookies(cookie).gf_player_sig||'',expected=playerSignature(id);return /^[0-9a-f]{64}$/i.test(supplied)&&crypto.timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex'));}
function playerCookieHeaders(id){const base='gf_player='+id+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000';return PLAYER_COOKIE_SECRET?[base,'gf_player_sig='+playerSignature(id)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000']:[base];}
function authOriginAllowed(req){try{return !!PLAYER_COOKIE_SECRET&&PLAYER_COOKIE_SECRET.length>=32&&new URL(process.env.APP_ORIGIN).protocol==='https:'&&req.headers.origin===new URL(process.env.APP_ORIGIN).origin;}catch{return false;}}
function authCookieToken(req){return parseCookies(req.headers.cookie||'').gf_session||null;}
function setAuthCookies(res,account,token){res.setHeader('Set-Cookie',[...playerCookieHeaders(account.player_id),sessionCookie(token,30*24*60*60)]);}
function authError(res,error){if(error.code==='RATE_LIMITED'){res.setHeader('Retry-After',String(Math.max(1,Math.ceil(error.retryAfterMs/1000))));return json(res,429,{error:'Слишком много попыток. Попробуйте позже.'});}if(error.code==='INVALID_CREDENTIALS')return json(res,401,{error:'Неверный логин или пароль.'});if(error.code==='EMAIL_NOT_VERIFIED')return json(res,403,{error:'Сначала подтвердите email.'});if(/UNIQUE constraint|duplicate key/i.test(error.message||''))return json(res,409,{error:'Имя пользователя или email уже заняты.'});console.error('account operation failed',error.message);return json(res,503,{error:'Операция временно недоступна.'});}
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
function attackIntersects(a,v,kind,range){
  const dx=(v.x-a.x)*a.dir;
  if(dx<18||dx>range+24)return false;
  const shape=kind==='special'?{top:150,bottom:18}:kind==='grab'?{top:108,bottom:6}:kind==='airPunch'||kind==='airKick'?{top:132,bottom:14}:kind==='heavyKick'?{top:96,bottom:18}:kind==='heavyPunch'?{top:104,bottom:28}:kind==='kick'?{top:76,bottom:18}:{top:100,bottom:30};
  const hitTop=a.y-shape.top,hitBottom=a.y-shape.bottom;
  const hurtHeight=v.input?.crouch?66:112;
  const hurtTop=v.y-hurtHeight,hurtBottom=v.y;
  return hitTop<hurtBottom && hitBottom>hurtTop;
}

const server = http.createServer((req, res) => {
  let playerId=readPlayerId(req.headers.cookie||'');
  if(!playerId){playerId=crypto.randomUUID();res.setHeader('Set-Cookie',playerCookieHeaders(playerId));}
  if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.method==='PUT'&&['/api/settings','/api/profile'].includes(req.url?.split('?')[0])) && !(req.method==='POST'&&['/api/auth/register','/api/auth/login','/api/auth/logout','/api/auth/verify-email','/api/auth/resend-verification','/api/auth/forgot-password','/api/auth/reset-password'].includes(req.url?.split('?')[0]))) { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if(pathname.startsWith('/api/auth/')){
    if(req.method==='GET'&&pathname==='/api/auth/me'){
      const token=authCookieToken(req);if(!token)return json(res,401,{error:'Не выполнен вход.'});
      return authService.authenticate(token).then(account=>account?json(res,200,{account:{username:account.username,email:account.email,player_id:account.player_id}}):json(res,401,{error:'Сессия истекла.'}));
    }
    if(req.method==='POST'){
      if(!authOriginAllowed(req))return json(res,403,{error:'Проверка источника запроса не пройдена.'});
      if(!await dbReady)return json(res,503,{error:'Хранилище аккаунтов недоступно.'});
      if(pathname==='/api/auth/register'){
        if(!isMailReady())return json(res,503,{error:'Регистрация временно недоступна: почтовый сервис не настроен.'});
        return readJsonBody(req,16384).then(async body=>{
          const result=await authService.register({playerId,username:body.username,email:body.email,password:body.password});
          return json(res,201,{account:result.account,verificationSent:true});
        }).catch(error=>authError(res,error));
      }
      if(pathname==='/api/auth/login'){
        return readJsonBody(req,8192).then(async body=>{
          const result=await authService.login({identifier:body.identifier,password:body.password,userAgent:String(req.headers['user-agent']||'').slice(0,200),ipPrefix:String(req.socket.remoteAddress||'').slice(0,64)});
          setAuthCookies(res,result.account,result.token);
          return json(res,200,{account:result.account,expiresAt:result.expiresAt});
        }).catch(error=>authError(res,error));
      }
      if(pathname==='/api/auth/logout'){
        const token=authCookieToken(req);if(token)await authService.logout(token);
        res.setHeader('Set-Cookie','gf_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
        return json(res,200,{ok:true});
      }
      if(pathname==='/api/auth/verify-email'){
        return readJsonBody(req,8192).then(async body=>{const verified=await authService.verifyEmail(body.token);return json(res,verified?200:400,{verified});}).catch(error=>authError(res,error));
      }
      if(pathname==='/api/auth/resend-verification'){
        if(!isMailReady())return json(res,503,{error:'Почтовый сервис временно недоступен.'});
        return readJsonBody(req,8192).then(async body=>{await authService.resendVerification(body.identifier);return json(res,200,{accepted:true});}).catch(error=>authError(res,error));
      }
      if(pathname==='/api/auth/forgot-password'){
        if(!isMailReady())return json(res,503,{error:'Почтовый сервис временно недоступен.'});
        return readJsonBody(req,8192).then(async body=>json(res,200,await authService.requestPasswordReset(body.identifier))).catch(error=>authError(res,error));
      }
      if(pathname==='/api/auth/reset-password'){
        return readJsonBody(req,8192).then(async body=>json(res,await authService.resetPassword({token:body.token,password:body.password})?200:400,{reset:true})).catch(error=>authError(res,error));
      }
    }
    return json(res,405,{error:'Метод не поддерживается.'});
  }
  if(pathname==='/health'&&req.method==='GET')return dbReady.then(async ready=>{let healthy=false;try{healthy=ready&&await database.healthCheck();}catch(error){console.error('health database probe failed',error.message);}return json(res,healthy?200:503,{ok:healthy,statsReady:healthy,storage:database.isSqlite()?'sqlite':database.isPostgres()?'postgres':'file'});});
  if(pathname==='/api/profile'&&req.method==='GET')return profile(playerId,res);
  if(pathname==='/api/profile'&&req.method==='PUT')return readJsonBody(req).then(async body=>{
    const displayName=typeof body.displayName==='string'?body.displayName.trim():'';
    if(displayName.length<2||displayName.length>20||!/^[\p{L}\p{N} _-]+$/u.test(displayName))return json(res,400,{error:'Имя: 2–20 символов, буквы, цифры, пробел, дефис или подчёркивание.'});
    if(!await dbReady)return json(res,503,{error:'Profile database unavailable'});
    const saved=await database.saveDisplayName(playerId,displayName);
    if(!saved)return json(res,503,{error:'Persistent profiles require SQLite or PostgreSQL mode'});
    return json(res,200,{display_name:saved});
  }).catch(error=>json(res,error.message==='Request body too large'?413:400,{error:error.message}));
  if(pathname==='/api/history'&&req.method==='GET')return matchHistory(playerId,res);
  if(pathname==='/api/settings'&&req.method==='GET')return playerSettings(playerId,res,'GET');
  if(pathname==='/api/settings'&&req.method==='PUT')return readJsonBody(req).then(body=>playerSettings(playerId,res,'PUT',body)).catch(error=>json(res,error.message==='Request body too large'?413:400,{error:error.message}));
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
function playerState(x, dir, fighter=0) { return { x, y:0, vx:0, vy:0, dir, fighter:fighter===1?1:0, hp:100, power:0, block:false, input:{left:false,right:false,jump:false,dodge:false},jumpLatch:false,dodgeUntil:0,lastDodge:0,counterReadyUntil:0,attack:0,stun:0,invuln:0,lastAttack:0,lastStateAt:now(),lastPhysicsAt:now(),attackToken:null,lastInputSeq:0 }; }
function publicPlayer(p) { return { x:p.x, y:p.y, vx:p.vx, vy:p.vy, dir:p.dir, fighter:p.fighter, hp:p.hp, power:p.power, block:p.block, attack:p.attack, stun:p.stun, invuln:p.invuln, run:p.input.run, crouch:p.input.crouch,inputAck:p.lastInputSeq||0 }; }
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
async function saveMatch(room,winner,reason){
 if(room.statsSaved)return;
 if(!await dbReady)throw new Error('persistent database is not ready');
 if(!room.statsPrepared){
  for(let i=0;i<2;i++){const slot=room.slots[i];if(!slot||!slot.playerId)continue;
   const won=winner===i,draw=winner===null,ko=reason==='ko'&&won,x=statsData[slot.playerId]||emptyStats();
   x.matches++;if(won){x.wins++;x.win_streak++;x.knockouts+=ko?1:0;}else if(draw){x.draws++;x.win_streak=0;}else{x.losses++;x.win_streak=0;}
   x.best_streak=Math.max(x.best_streak,x.win_streak);
   if(slot.fighter===0)x.fighter_0_count++;else x.fighter_1_count++;
   x.favorite_fighter=x.fighter_0_count>=x.fighter_1_count?0:1;
   statsData[slot.playerId]=x;
  }
  const ids=room.slots.map(slot=>slot.playerId);
  if(ids[0]&&ids[1]&&statsData[ids[0]]&&statsData[ids[1]]){
   const first=statsData[ids[0]],second=statsData[ids[1]];
   const expectedFirst=1/(1+Math.pow(10,((second.rating||1000)-(first.rating||1000))/400));
   const scoreFirst=winner===null ? 0.5 : winner===0 ? 1 : 0;
   const delta=Math.round(32*(scoreFirst-expectedFirst));
   first.rating=Math.max(0,(first.rating||1000)+delta);
   second.rating=Math.max(0,(second.rating||1000)-delta);
  }
  room.statsPrepared=true;
 }
 const ids=room.slots.map(slot=>slot.playerId);
 await database.recordMatch(statsData,{
  matchId:room.matchId,roomCode:room.code,playerIds:ids,
  fighters:room.slots.map(slot=>slot.fighter),winner,reason,round:room.round
 });
 room.statsSaved=true;
}
async function endRound(room, winner, reason) {
  if(room.status!=='playing') return;
  room.status='saving';
  if(winner===0||winner===1) room.wins[winner]++;
  const champion=room.wins.some(v=>v>=2)||(winner===null&&room.round>=3);
  room.matchComplete=champion;
  room.lastResult={winner,reason,round:room.round,wins:room.wins.slice(),champion,statsSaved:!champion};
  if(champion){
    for(let attempt=0;attempt<3;attempt++){
      try{await saveMatch(room,winner,reason);room.lastResult.statsSaved=true;break;}
      catch(error){room.lastResult.statsSaved=false;console.error('match persistence attempt '+(attempt+1)+' failed',error.message);if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));}
    }
  }
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
    room={code,slots:[null,null],status:'waiting',resumeStatus:'waiting',lastResult:null,round:1,wins:[0,0],timer:99,statsSaved:false,statsPrepared:false,matchId:crypto.randomUUID(),matchComplete:false,arena:['sunset','night','dojo','underground','neon','harbor'].includes(msg.arena)?msg.arena:'sunset',rematchVotes:new Set(),gcAt:0};
    rooms.set(code,room);
  }
  const playerId=readPlayerId(ws._cookie||'');
  if(playerId)database.ensurePlayer(playerId).catch(error=>console.error('player registration failed',error.message));
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
  ws.room=room;ws.playerNo=idx+1;ws.lastMsg=0;ws.lastInputSeq=0;
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
  if(msg.type==='ping'){send(ws,{type:'pong',sentAt:msg.sentAt,serverTime:now()});return;}
  if(msg.type==='join') return join(ws,msg);
  const room=ws.room;
  if(!room) return;
  const idx=ws.playerNo-1, slot=room.slots[idx], other=room.slots[1-idx];
  if(!slot||slot.ws!==ws) return;
  if(msg.type==='input' && room.status==='playing'){
    const v=msg.input||{},p=slot.state;
    if(Number.isSafeInteger(msg.seq)){if(msg.seq<=ws.lastInputSeq)return;ws.lastInputSeq=msg.seq;p.lastInputSeq=msg.seq;}
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
      const hitDx=currentV.x-currentA.x;
      if(!attackIntersects(currentA,currentV,kind,range)||currentV.invuln>now())return;
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
      if(room.matchComplete||room.wins.some(v=>v>=2)){room.wins=[0,0];room.round=1;room.statsSaved=false;room.statsPrepared=false;room.matchId=crypto.randomUUID();room.matchComplete=false;}
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
   if(p.y<0||p.vy<0){p.y+=p.vy*dt/16.67;p.vy+=.48*dt/16.67;if(p.y>0){p.y=0;p.vy=0;}}else{p.y=0;p.vy=0;}
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
