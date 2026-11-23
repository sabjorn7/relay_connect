import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const file='public/data/98342e46-3cd3-48bc-bf0a-f1b60bf63535.json';
const before=JSON.parse(execFileSync('git',['show','HEAD:'+file],{maxBuffer:20*1024*1024}));
const after=JSON.parse(fs.readFileSync(file));
const ids=['7787eb50-0d7a-4449-982b-f41f1bda1ccd','09539750-d3c4-49b0-ac12-b07103065e52','ed6b96a4-a849-4da7-b66c-00287196f0d7','bb3f9590-8a49-40f8-9455-eeed3d72ac23'];
const create='256f1eb9-180c-4d95-b3c2-f81bbfac9b0f',provider='77a3a9ec-1157-4ef9-902c-24f3a1229e39',update='4380a8dd-e2a6-4ab5-9c44-98723e7f9a6c',redirect='417b8d6f-f0a7-4958-9521-f7f82105c689';
for(const id of ids){
 const a=after.wwObjects[id]._state.interactions[0].actions;
 const b=before.wwObjects[id]._state.interactions[0].actions;
 assert.equal(a[create].args.functionName,'club_prepare_subscription_order');
 assert.deepEqual(a[create].args.params.map(p=>p.key),['p_club_id']);
 assert.equal(a[provider].next,redirect);assert.equal(a[update],undefined);
 const order={id:'order-fixture',club_id:'club-fixture',subscription_id:'12345',price:3500};
 const context={workflow:{[create]:{result:order}},component:{variables:{'14d34912-0442-4607-9311-5c9590247a28':{club:{sub_id:'attacker-plan',price:1}}}}};
 const url=new URL(new Function('context',a[provider].args.url.code)(context));
 assert.equal(url.hostname,'meetguru.payform.ru');assert.equal(url.searchParams.get('subscription'),'12345');
 assert.equal(url.searchParams.get('order_id'),order.id);
 assert.throws(()=>new Function('context',a[provider].args.url.code)({workflow:{[create]:{result:null}}}));
 // Restore only allowed changed fields, then verify EVERYTHING else (including provider settings) unchanged.
 a[create]=b[create];a[provider].args.url=b[provider].args.url;a[provider].next=b[provider].next;a[update]=b[update];
}
// Do not print object diffs: the legacy file includes credentials.
assert.ok(JSON.stringify(after)===JSON.stringify(before) || equal(after,before),'Unexpected unrelated changes');
function equal(a,b){if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}
console.log('PASS four payment workflows; RPC-only parameters, server result URL, missing-result failure, forbidden UPDATE removed; all unrelated fields unchanged');
