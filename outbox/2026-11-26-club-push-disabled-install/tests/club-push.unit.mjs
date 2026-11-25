import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateClubPayload, clubNotification, handleClubEvent } from '../supabase/functions/web-push-send/club.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
let cases=0;function test(name,fn){return Promise.resolve().then(fn).then(()=>{cases++;console.log('PASS',name)})}
await test('club payload validation and non-disclosing notifications',()=>{
 assert.equal(validateClubPayload({event:'direct_message',message_id:A}),null);
 assert.deepEqual(validateClubPayload({event:'club_post',post_id:'bad'}),{error:'bad_club_event_id'});
 for(const event of ['club_message','club_post']){assert.equal(validateClubPayload({event,message_id:A,post_id:A}).clubEventId,A);const n=clubNotification(event,C);assert.equal(n.title,'МитГуру');assert.deepEqual(Object.keys(n).sort(),['body','data','event','title']);assert.equal(n.data.url,`/club/?club=${C}`)}
});
const source=readFileSync(new URL('../supabase/functions/web-push-send/index.ts',import.meta.url),'utf8');
const pure=source.match(/=== PURE LOGIC[\s\S]*?\n([\s\S]*?)\/\/ === \/PURE LOGIC/)[1].replace(/export function/g,'function');
const pickDmRecipients=new Function(`${pure};return pickDmRecipients`)();
const zero={recipients:0,subs:0,sent:0,failed:0,pruned:0,skippedRate:0,codes:{}};
async function run(opts={}){
 const calls=[],deliveries=[];const event=opts.event||'club_message';
 const dbGet=async(path)=>{calls.push(path);if(opts.fail)throw Error('db_error');if(path.startsWith('club_chat?'))return opts.missing?[]:[{id:A,club:C,owner:opts.sender||B,deleted:opts.deleted}];if(path.startsWith('club_posts?'))return [{id:A,club:C,date_send:opts.scheduled?'2027-01-01':null}];if(path.startsWith('clubs?'))return [{id:C,owner:A}];if(path.startsWith('club_subs?'))return [{id:C,suber:B},{id:B,suber:A},{id:A,suber:B}];if(path.startsWith('users?'))return [{id:A,send_notif:!opts.optOut},{id:B,send_notif:!opts.optOut}];throw Error('unexpected_table')};
 const result=await handleClubEvent(event,A,zero,{dbGet,json:x=>x,pickDmRecipients,allowAll:opts.allowAll!==false,allowlist:new Set(),fetchSubs:async(ids)=>ids.map(user_id=>({user_id})),deliver:async(s,p)=>{deliveries.push({s,p});return {sent:s.length,failed:0,pruned:0,codes:{}}}});return {result,calls,deliveries};
}
await test('message: subscribed owner notified, sender excluded, only metadata queried',async()=>{const r=await run();assert.equal(r.result.counts.sent,1);assert.equal(r.deliveries[0].s[0].user_id,A);assert(r.calls.every(p=>!/[?,]text|photos|customer|Name/.test(p)));assert(r.calls.some(p=>p.includes('active=eq.true&or=(end_date.is.null,end_date.gte.today)')))});
await test('post: current members notified; no publisher notification',async()=>{const r=await run({event:'club_post'});assert.equal(r.deliveries[0].s[0].user_id,B)});
for(const opts of [{missing:true},{deleted:true},{scheduled:true,event:'club_post'},{optOut:true},{allowAll:false},{sender:C}])await test('no send '+JSON.stringify(opts),async()=>{assert.equal((await run(opts)).deliveries.length,0)});
await test('DB failure never becomes broadcast',async()=>{await assert.rejects(run({fail:true}),/db_error/)});
await test('club extension is off by default and existing events preserved',()=>{assert(source.includes("Deno.env.get('PUSH_CLUB_ENABLED') === 'true'"));assert(source.includes("if (event === 'direct_message') return await handleDirectMessage"));assert(source.indexOf('await keyOk')<source.indexOf('await handleClubEvent'))});
console.log(JSON.stringify({pass:cases,fail:0,productionWrites:0}));
