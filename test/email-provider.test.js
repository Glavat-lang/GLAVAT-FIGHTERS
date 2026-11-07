'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {isMailReady,sendTransactionalEmail,escapeHtml}=require('../email-provider');
const env={RESEND_API_KEY:'re_test',MAIL_FROM:'GLAVAT <noreply@example.com>',APP_ORIGIN:'https://game.example.com'};
test('email delivery stays disabled until all secure provider settings exist',()=>{
 assert.equal(isMailReady({}),false);
 assert.equal(isMailReady({...env,APP_ORIGIN:'http://game.example.com'}),false);
 assert.equal(isMailReady({...env,APP_ORIGIN:'https://game.example.com/path'}),false);
 assert.equal(isMailReady(env),true);
});
test('transactional email sends through provider API and validates response',async()=>{
 let request;
 const result=await sendTransactionalEmail({to:'player@example.com',subject:'Verify',html:'<p>Click</p>'},{env,fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({id:'mail_123'})};}});
 assert.deepEqual(result,{id:'mail_123'});
 assert.equal(request.url,'https://api.resend.com/emails');
 assert.equal(request.options.headers.Authorization,'Bearer re_test');
 assert.deepEqual(JSON.parse(request.options.body).to,['player@example.com']);
 await assert.rejects(sendTransactionalEmail({to:'bad',subject:'x',html:'x'},{env,fetchImpl:async()=>({ok:true,json:async()=>({id:'x'})})}),/Invalid transactional email/);
 await assert.rejects(sendTransactionalEmail({to:'player@example.com',subject:'x',html:'x'},{env,fetchImpl:async()=>({ok:false,status:401})}),/401/);
});
test('HTML escaping prevents user-controlled markup injection',()=>assert.equal(escapeHtml('<script a="x">&'), '&lt;script a=&quot;x&quot;&gt;&amp;'));
