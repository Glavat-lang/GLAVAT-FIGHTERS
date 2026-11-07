'use strict';
const crypto=require('node:crypto');
const {hashPassword,verifyPassword,createOpaqueToken,hashToken,AttemptLimiter}=require('./auth-security');
const {escapeHtml}=require('./email-provider');
const dummyPasswordHash=hashPassword('GlavatDummyAccountProbe2026!');
function normalize(value){return String(value||'').trim().toLowerCase();}
function validateIdentity(username,email){
 if(typeof username!=='string'||!/^[A-Za-z0-9_]{3,24}$/.test(username))throw new Error('Username must be 3–24 letters, numbers or underscores');
 if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('A valid email address is required');
}
function createAuthService({database,sendEmail,env=process.env,clock=Date.now,limiter=new AttemptLimiter()}){
 if(!database)throw new Error('Database adapter is required');
 const origin=()=>{try{return new URL(env.APP_ORIGIN).origin;}catch{return '';}};
 async function takeRateLimit(key,limit=8,windowMs=15*60*1000){
  if(typeof database.consumeRateLimit==='function'){
   const digest=crypto.createHash('sha256').update(key,'utf8').digest('hex');
   return database.consumeRateLimit(digest,limit,windowMs,new Date(clock()));
  }
  return await takeRateLimit(key);
 }
 async function issueEmailToken(account,purpose){
  if(typeof sendEmail!=='function'||!origin())throw new Error('Transactional email is not configured');
  const token=createOpaqueToken(),tokenHash=hashToken(token),expiresAt=new Date(clock()+(purpose==='verify_email'?24:1)*60*60*1000).toISOString();
  await database.createAccountEmailToken({tokenId:crypto.randomUUID(),accountId:account.account_id,purpose,tokenHash,expiresAt});
  const verify=purpose==='verify_email',url=origin()+'/?'+(verify?'verify':'reset')+'='+encodeURIComponent(token);
  const heading=verify?'Confirm your GLAVAT FIGHTERS email':'Reset your GLAVAT FIGHTERS password';
  const action=verify?'Verify email':'Choose a new password';
  await sendEmail({to:account.email,subject:heading,html:'<p>'+heading+'</p><p><a href="'+escapeHtml(url)+'">'+action+'</a></p><p>If you did not request this, ignore this message.</p>',text:heading+'\n'+url});
  return true;
 }
 async function register({playerId,username,email,password}){
  const registrationAttempt=await takeRateLimit('register:'+normalize(email));if(!registrationAttempt.allowed){const error=new Error('Too many attempts');error.code='RATE_LIMITED';error.retryAfterMs=registrationAttempt.retryAfterMs;throw error;}
  validateIdentity(username,email);
  if(typeof password!=='string')throw new Error('Invalid password');
  const passwordHash=await hashPassword(password);
  const account=await database.createAccount({accountId:crypto.randomUUID(),playerId,username,email,passwordHash});
  await issueEmailToken(account,'verify_email');
  return {account:{account_id:account.account_id,player_id:account.player_id,username:account.username,email:account.email},verificationSent:true};
 }
 async function resendVerification(identifier){
  const resendAttempt=await takeRateLimit('resend:'+normalize(identifier));if(!resendAttempt.allowed){const error=new Error('Too many attempts');error.code='RATE_LIMITED';error.retryAfterMs=resendAttempt.retryAfterMs;throw error;}
  const account=await database.getAccountByLogin(identifier);
  if(!account||account.email_verified_at)return false;
  await issueEmailToken(account,'verify_email');return true;
 }
 async function verifyEmail(token){
  return database.consumeAccountEmailToken({tokenHash:hashToken(token),purpose:'verify_email',now:new Date(clock())});
 }
 async function login({identifier,password,sessionId,userAgent=null,ipPrefix=null}){
  const key='login:'+normalize(identifier),attempt=limiter.consume(key);
  if(!attempt.allowed){const error=new Error('Too many attempts');error.code='RATE_LIMITED';error.retryAfterMs=attempt.retryAfterMs;throw error;}
  const account=await database.getAccountByLogin(identifier);
  const passwordHash=account?account.password_hash:await dummyPasswordHash;
  const passwordMatches=await verifyPassword(typeof password==='string'?password:'',passwordHash);
  if(!account||!passwordMatches){const error=new Error('Invalid credentials');error.code='INVALID_CREDENTIALS';throw error;}
  if(!account.email_verified_at){const error=new Error('Email verification required');error.code='EMAIL_NOT_VERIFIED';throw error;}
  const token=createOpaqueToken(),tokenHash=hashToken(token),id=sessionId||crypto.randomUUID();
  const expiresAt=new Date(clock()+30*24*60*60*1000).toISOString();
  await database.createAccountSession({sessionId:id,accountId:account.account_id,tokenHash,expiresAt,userAgent,ipPrefix});
  if(typeof database.consumeRateLimit!=='function')limiter.clear(key);
  return {token,expiresAt,account:{account_id:account.account_id,player_id:account.player_id,username:account.username,email:account.email}};
 }
 async function authenticate(token){
  if(typeof token!=='string')return null;
  let digest;try{digest=hashToken(token);}catch{return null;}
  return database.getAccountBySession(digest,new Date(clock()));
 }
 async function logout(token){
  let digest;try{digest=hashToken(token);}catch{return false;}
  return database.revokeAccountSession(digest,new Date(clock()));
 }
 async function requestPasswordReset(identifier){
  const resetAttempt=await takeRateLimit('reset:'+normalize(identifier));if(!resetAttempt.allowed){const error=new Error('Too many attempts');error.code='RATE_LIMITED';error.retryAfterMs=resetAttempt.retryAfterMs;throw error;}
  const account=await database.getAccountByLogin(identifier);
  if(!account)return {accepted:true};
  try{await issueEmailToken(account,'password_reset');}catch(error){if(error.message==='Transactional email is not configured')throw error;console.error('password reset email delivery failed',error.message);}
  return {accepted:true};
 }
 async function resetPassword({token,password}){
  const passwordHash=await hashPassword(password);
  return database.consumeAccountEmailToken({tokenHash:hashToken(token),purpose:'password_reset',passwordHash,now:new Date(clock())});
 }
 return {register,resendVerification,verifyEmail,login,authenticate,logout,requestPasswordReset,resetPassword};
}
module.exports={createAuthService,validateIdentity};
