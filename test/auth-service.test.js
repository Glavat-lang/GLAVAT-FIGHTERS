'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const db=require('../database');
const {createAuthService}=require('../auth-service');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gf-auth-service-'));
process.env.DATABASE_MODE='sqlite';process.env.SQLITE_FILE=path.join(root,'db.sqlite');delete process.env.DATABASE_URL;
let clock=Date.now(),messages=[];
const env={APP_ORIGIN:'https://fighters.example.com'};
const service=createAuthService({database:db,env,clock:()=>clock,sendEmail:async message=>{messages.push(message);return {id:'mock'};}});
test('registration, verification, login, session, reset and logout lifecycle',async()=>{
 try{
  await db.init(path.join(root,'legacy.json'));
  const playerId='11111111-1111-4111-8111-111111111111';
  const registered=await service.register({playerId,username:'ArcadePlayer',email:'player@example.test',password:'StrongPassword2026!'});
  assert.equal(registered.account.player_id,playerId);
  assert.equal(messages.length,1);
  for(let i=0;i<8;i++)await assert.rejects(service.login({identifier:'missing@example.test',password:'WrongPassword2026!'}),error=>error.code==='INVALID_CREDENTIALS');
  await assert.rejects(service.login({identifier:'missing@example.test',password:'WrongPassword2026!'}),error=>error.code==='RATE_LIMITED','failed login attempts must be limited by persistent database buckets');

  const verifyToken=new URL(messages[0].html.match(/href="([^"]+)/)[1]).searchParams.get('verify');
  assert.equal(await service.verifyEmail(verifyToken),true);
  assert.equal(await service.verifyEmail(verifyToken),false);
  const logged=await service.login({identifier:'ARCADEPLAYER',password:'StrongPassword2026!'});
  assert.equal((await service.authenticate(logged.token)).account_id,registered.account.account_id);
  const forgot=await service.requestPasswordReset('player@example.test');
  assert.deepEqual(forgot,{accepted:true});
  assert.equal(messages.length,2);
  const resetToken=new URL(messages[1].html.match(/href="([^"]+)/)[1]).searchParams.get('reset');
  assert.equal(await service.resetPassword({token:resetToken,password:'AnotherStrong2026!'}),true);
  assert.equal(await service.authenticate(logged.token),null,'password reset must invalidate previous sessions');
  const relogged=await service.login({identifier:'player@example.test',password:'AnotherStrong2026!'});
  assert.ok(await service.authenticate(relogged.token));
  assert.equal(await service.logout(relogged.token),true);
  assert.equal(await service.authenticate(relogged.token),null);
 }finally{try{await db.close()}catch{};fs.rmSync(root,{recursive:true,force:true});}
});
