import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/web-push-send/club.mjs','utf8');
const index=fs.readFileSync('supabase/functions/web-push-send/index.ts','utf8');
assert.equal(index,fs.readFileSync('baseline-index.ts','utf8'),'existing dispatcher/env gates unchanged');
const body=index.match(/=== PURE LOGIC[\s\S]*?\n([\s\S]*?)\/\/ === \/PURE LOGIC/)[1].replace(/export function/g,'function');
const pickDmRecipients=new Function(`${body};return pickDmRecipients`)();
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',CLUB='737b8824-88b8-4cee-b50b-3f4ed3b59683';let count=0;
async function moduleFor(ids){return import('data:text/javascript;base64,'+Buffer.from(source.replace('userIds: Object.freeze([])',`userIds: Object.freeze(${JSON.stringify(ids)})`)).toString('base64'))}
async function run(opts={}){
 const mod=await moduleFor(opts.ids??[B]);const db=[],subscriptions=[],deliveries=[];
 const deps={pickDmRecipients,allowAll:opts.globalAll!==false,allowlist:new Set(opts.globalIds||[]),json:x=>x,dbGet:async q=>{db.push(q);if(q.startsWith('club_chat?'))return [{id:A,club:opts.club||CLUB,owner:opts.sender||A,deleted:!!opts.deleted}];if(q.startsWith('club_posts?'))return [{id:A,club:opts.club||CLUB,date_send:opts.scheduled?'2099-01-01':null}];if(q.startsWith('clubs?'))return [{id:CLUB,owner:A}];if(q.startsWith('club_subs?'))return (opts.members||[A,B,C]).map((suber,i)=>({id:String(i),suber}));if(q.startsWith('users?'))return (opts.users||[A,B,C]).map(id=>({id,send_notif:!(opts.optOut||[]).includes(id)}));throw Error('unexpected query')},fetchSubs:async ids=>{subscriptions.push(...ids);return ids.flatMap(user_id=>[{user_id},{user_id}])},deliver:async(subs,payload)=>{deliveries.push({subs,payload:JSON.parse(payload)});return {sent:subs.length}}};
 const result=await mod.handleClubEvent(opts.event||'club_message',A,{sent:0},deps);return {result,db,subscriptions,deliveries,mod};
}
for(const event of ['club_message','club_post']){const r=await run({event});assert.deepEqual(r.subscriptions,[B]);assert.equal(r.deliveries[0].subs.length,2);assert.equal(r.deliveries[0].payload.data.url,'/club/?club='+CLUB);assert.deepEqual(Object.keys(r.deliveries[0].payload).sort(),['body','data','event','title']);count++}
for(const opts of [{ids:[]},{ids:['*']},{ids:[B,B]},{ids:Array(11).fill(B)},{club:C},{sender:B},{optOut:[B]},{members:[A,C]},{users:[A,C]},{globalAll:false},{globalAll:false,globalIds:[C]},{deleted:true},{event:'club_post',scheduled:true}]){const r=await run(opts);assert.equal(r.deliveries.length,0,JSON.stringify(opts));if(opts.ids)assert.equal(r.db.length,0);count++}
const both=await run({ids:[B,C]});assert.deepEqual(both.subscriptions,[B,C]);count++;
const allow=await run({globalAll:false,globalIds:[B,C]});assert.deepEqual(allow.subscriptions,[B]);count++;
const {mod}=await run();assert.deepEqual(mod.validateClubPayload({event:'club_message',message_id:A,club_id:C,user_ids:[C]}),{event:'club_message',clubEventId:A});count++;
const fail=await moduleFor([B]);await assert.rejects(fail.handleClubEvent('club_message',A,{}, {dbGet:async()=>{throw Error('fixture unavailable')},json:x=>x}),/fixture unavailable/);count++;
console.log(`PASS ${count} pilot cases: exact club/accounts, global allowlist intersected, member/send_notif/sender checks, missing/invalid scope fail-closed, no content disclosure, no production requests`);
