import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
import {clubNotification} from '../supabase/functions/web-push-send/club.mjs';
const handlers={},shown=[],opened=[];const self={addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
vm.runInNewContext(fs.readFileSync('tests/serviceworker.fixture.js','utf8'),{self,URL,console});
const club='33333333-3333-4333-8333-333333333333';
for(const event of ['club_message','club_post']){
 const payload=clubNotification(event,club);let task;
 handlers.push({data:{json:()=>payload},waitUntil:p=>task=p});await task;
 const n=shown.at(-1);assert.equal(n.title,'МитГуру');assert.equal(n.options.body,payload.body);assert.equal(n.options.badge,'/images/notification-badge-mg-v2.png');
 handlers.notificationclick({notification:{data:n.options.data,close(){}},waitUntil:p=>task=p});await task;assert.equal(opened.at(-1),'/club/?club='+club);
}
assert.equal(shown.length,2);console.log('PASS: existing serviceworker displays both generic club events with existing icon/badge and routes clicks to /club; synthetic push event only, no provider delivery');
