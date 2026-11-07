'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const database=require('../database');
const {hashPassword,createOpaqueToken,hashToken}=require('../auth-security');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gf-auth-http-'));
const sqlitePath=path.join(root,'auth.sqlite'),statsPath=path.join(root,'stats.json');
const APP_ORIGIN='https://fighters.example.test',PLAYER_COOKIE_SECRET='test-only-secret-with-at-least-32-characters';
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
(async()=>{
 let child;
 try{
  process.env.DATABASE_MODE='sqlite';process.env.SQLITE_FILE=sqlitePath;delete process.env.DATABASE_URL;
  await database.init(statsPath);
  const playerId=crypto.randomUUID(),accountId=crypto.randomUUID();
  const passwordHash=await hashPassword('HttpAccountPass2026!');
  await database.createAccount({accountId,playerId,username:'HttpPlayer',email:'http-player@example.test',passwordHash});
  const verifyHash=hashToken(createOpaqueToken());
  await database.createAccountEmailToken({tokenId:crypto.randomUUID(),accountId,purpose:'verify_email',tokenHash:verifyHash,expiresAt:new Date(Date.now()+3600000).toISOString()});
  assert.equal(await database.consumeAccountEmailToken({tokenHash:verifyHash,purpose:'verify_email'}),true);
  await database.close();
  const port=await freePort(),base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),STATS_FILE:statsPath,DATABASE_MODE:'sqlite',SQLITE_FILE:sqlitePath,APP_ORIGIN,PLAYER_COOKIE_SECRET,RESEND_API_KEY:'',MAIL_FROM:''},stdio:'ignore'});
  let healthy=false;
  for(let i=0;i<80;i++){try{const response=await fetch(base+'/health');if(response.ok){healthy=true;break;}}catch{}await sleep(100);}
  assert.equal(healthy,true,'HTTP server must become healthy');
  const health=await fetch(base+'/health').then(response=>response.json());assert.equal(health.accountSecurityReady,true);assert.equal(health.mailReady,false);assert.equal(health.accountsReady,false,'health must distinguish live game storage from unavailable account email configuration');
  const denied=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example.test','Content-Type':'application/json'},body:JSON.stringify({identifier:'HttpPlayer',password:'HttpAccountPass2026!'})});
  assert.equal(denied.status,403,'cross-origin authentication requests must be rejected');
  const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({identifier:'HttpPlayer',password:'WrongPassword2026!'})});
  assert.equal(bad.status,401,'wrong credentials must not create a session');
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:APP_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({identifier:'HttpPlayer',password:'HttpAccountPass2026!'})});
  assert.equal(login.status,200);
  const cookies=login.headers.getSetCookie?login.headers.getSetCookie():[login.headers.get('set-cookie')||''];
  const sessionCookie=cookies.find(value=>value.startsWith('gf_session='));
  const playerCookie=cookies.find(value=>value.startsWith('gf_player='));
  const signatureCookie=cookies.find(value=>value.startsWith('gf_player_sig='));
  assert.ok(sessionCookie&&playerCookie&&signatureCookie,'login must set HttpOnly session and signed player identity cookies');
  const cookieHeader=[sessionCookie,playerCookie,signatureCookie].map(value=>value.split(';')[0]).join('; ');
  const me=await fetch(base+'/api/auth/me',{headers:{Cookie:cookieHeader}});
  assert.equal(me.status,200);
  assert.equal((await me.json()).account.username,'HttpPlayer');
  const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:APP_ORIGIN,'Content-Type':'application/json',Cookie:cookieHeader},body:JSON.stringify({username:'NewPlayer',email:'new@example.test',password:'NewHttpPass2026!'})});
  assert.equal(registration.status,503,'registration must fail closed when no transactional email provider is configured');
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Origin:APP_ORIGIN,Cookie:cookieHeader}});
  assert.equal(logout.status,200);
  const after=await fetch(base+'/api/auth/me',{headers:{Cookie:cookieHeader}});
  assert.equal(after.status,401,'logout must revoke the session server-side');
  process.stdout.write('Account HTTP origin protection, login, secure cookies, session lookup, mail fail-closed behavior and logout passed.\\n');
 }finally{
  if(child){child.kill('SIGTERM');await sleep(100);}
  try{await database.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
