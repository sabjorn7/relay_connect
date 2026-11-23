// Browser execution of the actual four URL formulas; synthetic RPC/provider, no real orders.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync('public/data/98342e46-3cd3-48bc-bf0a-f1b60bf63535.json'));
const create='256f1eb9-180c-4d95-b3c2-f81bbfac9b0f',provider='77a3a9ec-1157-4ef9-902c-24f3a1229e39';
const formulas=Object.values(data.wwObjects).flatMap(o=>(o._state?.interactions||[]).filter(w=>w.actions?.[create]).map(w=>w.actions[provider].args.url.code));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mg-club-browser-'));
let chrome,ws;
try{
 chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND','--remote-debugging-port=0','--user-data-dir='+dir,'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((resolve,reject)=>{let s='';const t=setTimeout(()=>reject(Error('Chrome timeout')),15000);chrome.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});chrome.on('exit',()=>reject(Error('Chrome exited')));});
 ws=new WebSocket(address);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 await send('Network.enable',{},sessionId);await send('Network.setBlockedURLs',{urls:['http://*','https://*','ws://*','wss://*']},sessionId);
 const expression=`(async()=>{
 const formulas=${JSON.stringify(formulas)},create=${JSON.stringify(create)};
 const results=[];
 for(const code of formulas){
  let orders=0,redirects=0,providerCalls=0;let saved;
  const prepare=async()=>saved??=(orders++,{id:'order-fixture',club_id:'club-fixture',subscription_id:'12345'});
  const click=async({guest=false,fail=false}={})=>{if(guest)return 'login';const order=await prepare();const url=new URL(new Function('context',code)({workflow:{[create]:{result:order}}}));if(url.searchParams.get('subscription')!=='12345')throw Error('wrong plan');providerCalls++;if(fail)throw Error('Synthetic provider error');redirects++;return 'https://meetguru.payform.ru/fixture';};
  if(await click({guest:true})!=='login'||orders!==0)throw Error('guest wrote');
  try{await click({fail:true});throw Error('missing failure');}catch(e){if(e.message!=='Synthetic provider error')throw e;}
  if(redirects!==0||orders!==1)throw Error('failure redirected');
  await click();await Promise.all([click(),click()]);
  if(orders!==1||redirects!==3||providerCalls!==4)throw Error('retry failed');
  results.push('PASS guest / provider error / retry / repeat order / link');
 }
 return results;
})()`;
 const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
 assert.ok(!r.exceptionDetails,'Browser scenario failed');assert.equal(r.result.value.length,4);console.log(r.result.value.join('\n'));console.log('PASS Chrome synthetic boundary; full legacy page and real provider not exercised');
}finally{if(ws)ws.close();if(chrome)chrome.kill();}
