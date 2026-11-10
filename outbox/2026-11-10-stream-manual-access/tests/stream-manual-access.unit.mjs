// Focused stream-list/access regression; no push-worker or router changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateVisibility, isPublicStream, streamLinkKey, streamShareUrl, visibilityCapabilities, requireUnlistedSupport } from '../src/_front/streams/visibility.js';
import { videoProfile } from '../src/_front/streams/videoQuality.js';

// Import the real data helpers with ONLY the destructive PeerTube delete dependency stubbed.
// No browser, auth service, SDK or network is started.
let source = await readFile(new URL('../src/_front/streams/streamsApi.js', import.meta.url), 'utf8');
source = source.replace("from './videoQuality.js'", `from '${new URL('../src/_front/streams/videoQuality.js', import.meta.url).href}'`);
source = source.replace("from './visibility.js'", `from '${new URL('../src/_front/streams/visibility.js', import.meta.url).href}'`)
    .replace("import { deleteLive } from '@/_front/streams/peertubeLive.js';", 'const deleteLive = async () => { throw new Error("network forbidden"); };');
const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('manual grant uses one owner-checked RPC and never writes money or access from the browser',async()=>{
 const calls=[];const sb={from(){throw Error('direct write forbidden')},rpc:async(name,args)=>{calls.push({name,args});return {data:{status:'granted',access_id:'synthetic'}};}};
 assert.equal((await api.grantStreamAccessByEmail(sb,'stream',' VIEWER@EXAMPLE.INVALID ')).status,'granted');assert.deepEqual(calls,[{name:'grant_stream_access_by_email',args:{p_stream_id:'stream',p_email:'viewer@example.invalid'}}]);
});
test('invalid email stops before RPC',async()=>{for(const email of ['', 'a b@example.invalid','a@','x'.repeat(321)])await assert.rejects(api.grantStreamAccessByEmail({rpc(){throw Error('RPC must not execute')}},'stream',email),/корректный email/);});
test('unregistered user gets a clear message',async()=>{await assert.rejects(api.grantStreamAccessByEmail({rpc:async()=>({error:{message:'registered_user_not_found'}})},'stream','viewer@example.invalid'),/не зарегистрирован/);});
test('permission errors do not leak raw database details',async()=>{
 for(const message of ['not_stream_owner','auth_required','synthetic internal secret'])await assert.rejects(api.grantStreamAccessByEmail({rpc:async()=>({error:{message}})},'stream','viewer@example.invalid'),e=>!e.message.includes('synthetic internal secret'));
});
test('unknown RPC result is never reported as a successful grant',async()=>{await assert.rejects(api.grantStreamAccessByEmail({rpc:async()=>({data:{status:'unknown'}})},'stream','viewer@example.invalid'),/не подтвердил/);});
test('buyers label only non-paid Free entitlement and preserves paid buyers',async()=>{
 const rows=[{id:'paid',user:'a',buy:true,Free:false},{id:'manual',user:'b',buy:false,Free:true},{id:'converted-to-paid',user:'c',buy:true,Free:true},{id:'placeholder',user:'d',buy:false,Free:false}];
 const sb={from(table){const result=table==='user_course'?rows:rows.map(r=>({id:r.user,Name:r.id,email:r.user+'@example.invalid'}));const chain=new Proxy({},{get:(_,k)=>k==='then'?resolve=>resolve({data:result}):()=>chain});return chain;}};
 const result=await api.listStreamBuyers(sb,{backing_course_id:'backing'});assert.deepEqual(result.map(r=>r.addedWithoutPayment),[false,true,false,false]);
});
test('buyers read failure is surfaced instead of pretending the list is empty',async()=>{
 const chain=new Proxy({},{get:(_,k)=>k==='then'?resolve=>resolve({error:{message:'denied'}}):()=>chain});await assert.rejects(api.listStreamBuyers({from:()=>chain},{backing_course_id:'backing'}),/загрузить доступы/);
});
