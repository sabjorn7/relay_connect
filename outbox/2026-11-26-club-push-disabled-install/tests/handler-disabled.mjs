import fs from 'node:fs';import assert from 'node:assert/strict';import {stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';
const fake={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',PUSH_SEND_KEY:'synthetic-push',VAPID_PUBLIC:'synthetic-public',VAPID_PRIVATE:'synthetic-private',PUSH_ENABLED:'true',PUSH_ALLOWLIST:'*'};
globalThis.Deno={env:{get:k=>fake[k]},serve:()=>{}};let network=0;globalThis.fetch=async()=>{network++;throw Error('network forbidden')};
let s=fs.readFileSync('supabase/functions/web-push-send/index.ts','utf8').replace("import webpush from 'npm:web-push@3.6.7';","const webpush={setVapidDetails(){},sendNotification(){throw Error('delivery forbidden')}};").replace("import { SUPABASE_URL as SB_URL_CONST } from '../_shared/og.mjs';","const SB_URL_CONST='https://fixture.invalid';").replace("'./club.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/supabase/functions/web-push-send/club.mjs').href));
const {handler}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(s)).toString('base64'));
async function run(payload,key=true){return handler(new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json',...(key?{'x-push-key':'synthetic-push'}:{})},body:JSON.stringify(payload)}))}
assert.equal((await run({},false)).status,401);
for(const event of ['stream_start','chat_message','direct_message'])assert.equal((await run({event})).status,400);
for(const event of ['club_message','club_post']){const r=await run({event,message_id:'11111111-1111-4111-8111-111111111111',post_id:'11111111-1111-4111-8111-111111111111'});assert.equal(r.status,200);const b=await r.json();assert.equal(b.disabled,true);assert.equal(b.event,event);assert.equal(b.counts.sent,0)}
assert.equal(network,0);console.log('PASS handler: 401, existing invalid-ID 400, both club events disabled, zero network/provider calls (Node TS stripping; Deno runtime NOT TESTED)');
