'use strict';
const API='https://api.resend.com/emails';
function mailConfiguration(env=process.env){
  return {apiKey:env.RESEND_API_KEY||'',from:env.MAIL_FROM||'',origin:env.APP_ORIGIN||''};
}
function isMailReady(env=process.env){
  const c=mailConfiguration(env);
  try{const origin=new URL(c.origin);return !!c.apiKey&&!!c.from&&origin.protocol==='https:'&&origin.origin===c.origin;}catch{return false;}
}
async function sendTransactionalEmail({to,subject,html,text},options={}){
  const env=options.env||process.env,fetchImpl=options.fetchImpl||globalThis.fetch,c=mailConfiguration(env);
  if(!isMailReady(env))throw new Error('Transactional email is not configured');
  if(typeof fetchImpl!=='function')throw new Error('Fetch is unavailable');
  if(typeof to!=='string'||!to.includes('@')||typeof subject!=='string'||!subject||typeof html!=='string'||!html)throw new Error('Invalid transactional email');
  const response=await fetchImpl(API,{method:'POST',headers:{Authorization:'Bearer '+c.apiKey,'Content-Type':'application/json'},body:JSON.stringify({from:c.from,to:[to],subject,html,text:text||''}),signal:AbortSignal.timeout(10000)});
  if(!response.ok){const status=response.status;throw new Error('Email provider rejected delivery ('+status+')');}
  const result=await response.json();
  if(!result||typeof result.id!=='string')throw new Error('Email provider returned no message id');
  return {id:result.id};
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
module.exports={mailConfiguration,isMailReady,sendTransactionalEmail,escapeHtml};
