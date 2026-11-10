// Real StreamsPage + Vue Router; synthetic users/API, self-only CSP and DNS block.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-my-streams-ui-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
const api=`const f=()=>window.fixture;
export const canStream=u=>!!u&&['Спикер','Учебное заведение'].includes(u.role);
export async function listAllStreams(){if(f().catalogFail)throw Error('Synthetic catalog error');return f().rows.filter(s=>s.visibility==='public'&&!s.hidden);}
export async function listMyStreams(sb,id){f().queries.push(id);if(f().mineFail)throw Error('Synthetic owner-list error');return [...f().rows.filter(s=>s.author===id),f().rows.find(s=>s.author!==id&&s.visibility==='unlisted')];}
export async function getStreamLinkKey(sb,id){f().linkReads.push(id);if(!f().rows.some(s=>s.id===id&&s.author===f().user?.id))throw Error('not owner');return 'a'.repeat(64);}
export async function createStream(sb,fields){const row={...fields,id:'created',status:'scheduled',hidden:false};f().rows.push(row);f().created=row;return row;}
export async function getStreamById(sb,id){return f().rows.find(s=>s.id===id)||f().created;}
export async function updateStream(sb,id,patch){f().updates.push({id,patch});Object.assign(f().rows.find(s=>s.id===id),patch);}
export const accessExpiry=()=>null,hasBoughtStream=async()=>false,listStreamMessages=async()=>[],listStreamBuyers=async(sb,s)=>f().buyers?.[s.id]||[];
export async function grantStreamAccessByEmail(sb,id,email){
 f().grantCalls.push({id,email});if(f().grantDelay)await new Promise(resolve=>{f().grantRelease=resolve;});
 if(email.trim().toLowerCase()!=='viewer@example.invalid')throw Error('Пользователь с таким email не зарегистрирован на MeetGuru.');
 const rows=f().buyers[id]||[];if(rows.some(r=>r.user.email==='viewer@example.invalid'))return {status:'already_has_access'};
 rows.push({id:'manual-viewer',user:{Name:'Synthetic viewer',email:'viewer@example.invalid'},addedWithoutPayment:true});f().buyers[id]=rows;return {status:'granted'};
}
export const purchaseStream=()=>{throw Error('payment forbidden')},createBackingCourse=()=>{throw Error('payment forbidden')};
export const setStreamStatus=()=>{throw Error('live forbidden')},deleteStream=()=>{throw Error('delete forbidden')},sendStreamMessage=()=>{throw Error('chat write forbidden')},deleteStreamMessage=()=>{throw Error('chat write forbidden')};`;
const peer=`export const VIDEO_STATE={PUBLISHED:1,LIVE_ENDED:5};export const getVideoInfo=async()=>({state:{id:1},isLive:false}),assetUrl=x=>x,embedUrl=()=>'/frame';export const createLive=async()=>({video:{uuid:'synthetic-video'},rtmpUrl:'synthetic-local',streamKey:'synthetic-only'});export const getLiveCredentials=()=>{throw Error('credentials forbidden')};`;
const auth=`export const readStoredSession=()=>window.fixture.user?{user:window.fixture.user}:null,authCookieUser=()=>null,waitForUid=async()=>null;`;
const live=`export class LiveApiError extends Error{};export const startLive=()=>{throw Error('live forbidden')},stopLive=startLive,inviteCohost=startLive,removeCohost=startLive;`;
const mocks={'streams/streamsApi.js':api,'streams/peertubeLive.js':peer,'chrome/headerAccount.js':auth,'streams/liveApi.js':live,'streams/cohosts.js':'export const listCohosts=async()=>[],getMyCohostRole=async()=>null;',
 'chrome/errorLogger.js':'export const logClientEvent=()=>{};',
 'components/PushToggle.vue':'export default {render(){return null}};',
 'components/StreamDiagnostics.vue':'export default {render(){return null}};'};
fs.writeFileSync(path.join(work,'index.html'),'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>');
fs.writeFileSync(path.join(work,'main.js'),`import {createApp} from 'vue';import {createRouter,createWebHistory} from 'vue-router';import Page from ${JSON.stringify(path.join(root,'src/_front/views/StreamsPage.vue'))};
const params=new URLSearchParams(location.search),actor=params.get('actor')||'owner';
const rows=[];for(const visibility of ['public','unlisted'])for(const status of ['scheduled','live','ended'])rows.push({id:visibility+'-'+status,author:'owner',title:visibility+' '+status,visibility,status,price:0,mode:'multi',hidden:false});
rows.push({id:'paid',author:'owner',title:'Paid public',visibility:'public',status:'scheduled',price:3500,backing_course_id:'course',mode:'multi',hidden:false});
rows.push({id:'foreign-hidden',author:'other',title:'Foreign hidden',visibility:'unlisted',status:'scheduled',price:0,mode:'multi',hidden:false});
const user=actor==='guest'?null:{id:actor,role:'Спикер',Name:'Synthetic organizer'};
window.fixture={rows,user,buyers:{paid:[{id:'existing-paid',user:{Name:'Paid viewer',email:'paid@example.invalid'},addedWithoutPayment:false}]},grantCalls:[],queries:[],linkReads:[],copied:[],updates:[],catalogFail:params.has('catalog-fail'),mineFail:params.has('mine-fail')};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.fixture.copied.push(text)},configurable:true});
const chain=new Proxy({}, {get:(_,method)=>method==='then'?resolve=>resolve({data:user?[user]:[],error:null}):()=>chain});
window.wwLib={wwPlugins:{supabase:{instance:{from:()=>chain,rpc:async name=>({data:name==='stream_visibility_capabilities'?{version:2,unlisted_enabled:true}:{version:1,full_hd_enabled:false},error:null})}}}};
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:Page}]});createApp({template:'<router-view />'}).use(router).mount('#app');`);
await build({root:work,configFile:false,plugins:[{name:'synthetic-integrations',enforce:'pre',resolveId(id){const key=Object.keys(mocks).find(k=>id.endsWith('/_front/'+k));if(key)return '\0mock:'+key+'.js';},load(id){if(id.startsWith('\0mock:'))return mocks[id.slice(6,-3)];}},vue()],logLevel:'error',resolve:{alias:{'@':path.join(root,'src'),'vue':path.join(root,'node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:");const rel=req.url.split('?')[0];const file=path.join(work,'dist',rel.startsWith('/assets/')?rel:'index.html');if(!file.startsWith(path.join(work,'dist')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser,ws;const results=[];
try{
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+path.join(work,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((resolve,reject)=>{let s='';const t=setTimeout(()=>reject(Error('Chrome timeout')),15000);browser.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});browser.on('exit',()=>reject(Error('Chrome exited')));});
 ws=new WebSocket(address);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await send('Page.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Network.setBlockedURLs',{urls:['https://*','wss://*','ws://*']},sessionId);
 const until=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out: '+expression);};
 const navigate=async query=>{await send('Page.navigate',{url:origin+'/?'+query},sessionId);await until('!!document.querySelector(".sp-catalog")');};
 const filter=async label=>ev(`[...document.querySelectorAll('.sp-mine-filters button')].find(b=>b.textContent==='${label}').click()`);
 await navigate('actor=owner');await until('document.querySelectorAll(".sp-mine .sp-item").length===7');
 assert.equal(await ev('document.querySelectorAll(".sp-catalog .pd-course").length'),4);
 assert(await ev('!!(document.querySelector(".sp-mine").compareDocumentPosition(document.querySelector(".sp-catalog"))&Node.DOCUMENT_POSITION_FOLLOWING)'));
 assert(await ev('[...document.querySelectorAll(".sp-mine .sp-item")].every(x=>["Открыть эфир","Редактировать","Копировать ссылку"].every(t=>x.textContent.includes(t)))'));
 assert(!await ev('document.querySelector(".sp-mine").textContent.includes("Foreign hidden")'));
 results.push('owner sees all own statuses, public/hidden/paid, actions and no foreign hidden; own block precedes public catalog');
 await ev('document.querySelector(".sp-buyers-toggle").click()');await until('!!document.querySelector(".sp-buyer-grant")');
 assert.equal(await ev('document.querySelectorAll(".sp-buyer-manual").length'),0);
 const submitEmail=async email=>{await ev(`var input=document.querySelector('.sp-buyer-grant input');input.value=${JSON.stringify(email)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.sp-buyer-grant').requestSubmit();`);};
 await submitEmail('missing@example.invalid');await until('document.querySelector(".sp-buyer-grant [role=alert]")?.textContent.includes("не зарегистрирован")');assert.equal(await ev('document.querySelectorAll(".sp-buyers-item").length'),1);results.push('unregistered email shows an error and adds no buyer');
 await submitEmail('viewer@example.invalid');await until('document.querySelectorAll(".sp-buyers-item").length===2');assert.equal(await ev('document.querySelectorAll(".sp-buyer-manual").length'),1);assert.equal(await ev('document.querySelector(".sp-buyer-manual").textContent'),'Добавлен без оплаты');results.push('manual viewer appears alongside existing buyer with exact no-payment label');
 await submitEmail('viewer@example.invalid');await until('document.querySelector(".sp-buyer-grant [role=status]")?.textContent.includes("уже есть доступ")');assert.equal(await ev('document.querySelectorAll(".sp-buyers-item").length'),2);results.push('repeated manual add confirms existing access without duplicate row');
 await ev('fixture.grantDelay=true');await submitEmail('viewer@example.invalid');await until('!!fixture.grantRelease');const beforeGrant=await ev('fixture.grantCalls.length');assert(await ev('document.querySelector(".sp-buyer-grant button").disabled'));await ev('document.querySelector(".sp-buyer-grant").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');assert.equal(await ev('fixture.grantCalls.length'),beforeGrant);await ev('fixture.grantDelay=false;fixture.grantRelease()');await until('!document.querySelector(".sp-buyer-grant button").disabled');results.push('pending grant disables controls and blocks double submission');
 await filter('Скрытые');assert.equal(await ev('document.querySelectorAll(".sp-mine .sp-item").length'),3);await filter('Публичные');assert.equal(await ev('document.querySelectorAll(".sp-mine .sp-item").length'),4);results.push('three visibility filters preserve all lifecycle statuses');
 await filter('Скрытые');await ev('[...document.querySelectorAll(".sp-mine .sp-item-actions button")].find(b=>b.textContent.includes("Копировать ссылку")).click()');await until('window.fixture.copied.length===1');
 assert(await ev('window.fixture.copied[0].includes("#access-")'));assert.deepEqual(await ev('window.fixture.linkReads'),['unlisted-scheduled']);
 await filter('Публичные');await ev('[...document.querySelectorAll(".sp-mine .sp-item-actions button")].find(b=>b.textContent.includes("Копировать ссылку")).click()');await until('window.fixture.copied.length===2');assert(!await ev('window.fixture.copied[1].includes("#access-")'));assert.equal(await ev('window.fixture.linkReads.length'),1);results.push('hidden/public copy reuse capability RPC and ordinary URL respectively');
 await ev('[...document.querySelectorAll(".sp-mine .sp-item-actions button")].find(b=>b.textContent.includes("Редактировать")).click()');await until('!!document.querySelector(".pd-dialog")');assert.equal(await ev('document.querySelector(".pd-dialog input").value'),'public scheduled');await ev('document.querySelector(".pd-x").click()');results.push('existing edit dialog opens from own list');
 for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);assert(await ev('document.documentElement.scrollWidth<=innerWidth'));await ev('document.querySelector(".sp-buyer-grant")?.scrollIntoView({block:"center"})');const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(work,'mine-'+width+'.png'),Buffer.from(shot.data,'base64'));results.push('responsive own list '+width);}
 await ev('[...document.querySelectorAll(".sp-card-head button")].find(b=>b.textContent.includes("Запланировать")).click()');await until('!!document.querySelector(".sp-form")');
 await ev(`const t=document.querySelector('.sp-form input[type="text"]');t.value='Synthetic hidden';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[name="stream-visibility"]').click();`);
 await ev('document.querySelector(".sp-form").requestSubmit()');await until('!!window.fixture.created');await until('!!document.querySelector(".sp-created button")');
 assert.equal(await ev('window.fixture.created.visibility'),'unlisted');assert.equal(await ev('document.querySelectorAll(".sp-catalog .pd-course").length'),4);assert.equal(await ev('document.querySelectorAll(".sp-mine .sp-item").length'),8);
 await ev('document.querySelector(".sp-created button").click()');await until('new URL(location.href).searchParams.get("stream")==="created"');results.push('hidden creation appears in own list only and offers direct navigation');
 await navigate('actor=guest');assert.equal(await ev('document.querySelector(".sp-mine")'),null);assert.deepEqual(await ev('window.fixture.queries'),[]);results.push('guest sees public catalog only; no owner query');
 await navigate('actor=other');await until('document.querySelectorAll(".sp-mine .sp-item").length===1');assert(await ev('document.querySelector(".sp-mine").textContent.includes("Foreign hidden")'));assert(!await ev('document.querySelector(".sp-mine").textContent.includes("unlisted scheduled")'));results.push('second organizer cannot see first organizer hidden rows even when mock returns a foreign row');
 await navigate('actor=owner&catalog-fail');await until('document.querySelectorAll(".sp-mine .sp-item").length===7');results.push('public catalog failure does not block owner list');
 await navigate('actor=owner&mine-fail');await until('!!document.querySelector(".sp-mine [role=alert]")');assert.equal(await ev('document.querySelectorAll(".sp-catalog .pd-course").length'),4);results.push('owner-list failure shows retry and preserves public catalog');
 console.log(JSON.stringify({pass:results.length,fail:0,results,artifacts:work}));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
