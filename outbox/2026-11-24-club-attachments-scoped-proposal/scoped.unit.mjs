import assert from 'node:assert/strict';
import {clubAttachmentsEnabled,prepareClubAttachment,sendClubAttachment} from './candidate/src/_front/helpers/clubAttachments.js';
const C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444',U='22222222-2222-4222-8222-222222222222';
let uploads=0,sends=0;const calls=[];
const sb={rpc:async(n,p)=>{calls.push([n,p]);if(n==='club_chat_capabilities')return {data:{attachments:p.p_club===C}};sends++;return {data:'ok'}},storage:{from:()=>({upload:async()=>{uploads++;return {error:null}}})}};
assert.equal(await clubAttachmentsEnabled(sb),false);assert.equal(calls.length,0);
assert.equal(await clubAttachmentsEnabled(sb,D),false);
assert.equal(await clubAttachmentsEnabled(sb,C),true);
assert.equal(await clubAttachmentsEnabled({rpc:async()=>{throw Error('offline')}},C),false);
for(const [name,type] of [['x.png','image/png'],['x.pdf','application/pdf'],['x.mp3','audio/mpeg']]){
 const file=new File(['test'],name,{type});const item=prepareClubAttachment(file,C,U);
 assert.equal(await sendClubAttachment(sb,item,u=>u===U),'ok');
 const wrong=prepareClubAttachment(file,D,U);await assert.rejects(sendClubAttachment(sb,wrong,()=>true),/attachments_disabled/);
 await assert.rejects(sendClubAttachment(sb,item,()=>false),/session_changed/);
}
assert.equal(uploads,3);assert.equal(sends,3);assert(calls.filter(([n])=>n==='club_chat_send_attachment').every(([,p])=>p.p_club===C));
console.log('PASS: frontend scoped RPC, invalid/empty club denied, offline fails closed, image/document/audio, other club cannot upload, session change denied');
