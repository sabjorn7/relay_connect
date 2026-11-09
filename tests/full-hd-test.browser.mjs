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
const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-full-hd-ui-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
const api=`const f=()=>window.fixture;
export const canStream=u=>!!u&&['Спикер','Учебное заведение'].includes(u.role);
export async function listAllStreams(){if(f().catalogFail)throw Error('Synthetic catalog error');return f().rows.filter(s=>s.visibility==='public'&&!s.hidden);}
export async function listMyStreams(sb,id){f().queries.push(id);if(f().mineFail)throw Error('Synthetic owner-list error');return [...f().rows.filter(s=>s.author===id),f().rows.find(s=>s.author!==id&&s.visibility==='unlisted')];}
export async function getStreamLinkKey(sb,id){f().linkReads.push(id);if(!f().rows.some(s=>s.id===id&&s.author===f().user?.id))throw Error('not owner');return 'a'.repeat(64);}
export async function createStream(sb,fields){const row={...fields,id:'created',status:'scheduled',hidden:false};f().rows.push(row);f().created=row;return row;}
export async function getStreamById(sb,id){return f().rows.find(s=>s.id===id)||f().created;}
export async function updateStream(sb,id,patch){f().updates.push({id,patch});Object.assign(f().rows.find(s=>s.id===id),patch);}
export const accessExpiry=()=>null,hasBoughtStream=async()=>false,listStreamMessages=async()=>[],listStreamBuyers=async()=>[];
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
window.fixture={rows,user,grant:params.has('grant'),rpcFail:false,queries:[],linkReads:[],copied:[],updates:[],catalogFail:params.has('catalog-fail'),mineFail:params.has('mine-fail')};
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.fixture.copied.push(text)},configurable:true});
const chain=new Proxy({}, {get:(_,method)=>method==='then'?resolve=>resolve({data:user?[user]:[],error:null}):()=>chain});
window.wwLib={wwPlugins:{supabase:{instance:{from:()=>chain,rpc:async(name,args)=>{const f=window.fixture;if(name==='stream_video_quality_for_stream'){if(f.rpcFail)return {error:{code:'synthetic'}};if(f.grant==='pending'&&args.p_stream_id==='unlisted-scheduled')return new Promise(r=>window.releaseCapability=r);return {data:{version:2,full_hd_allowed:f.grant===true&&f.user?.id==='owner'&&args.p_stream_id==='unlisted-scheduled'},error:null};}return {data:name==='stream_visibility_capabilities'?{version:2,unlisted_enabled:true}:{version:1,full_hd_enabled:false},error:null};}}}}};
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
 const openEdit=async label=>{await filter(label);await ev('[...document.querySelectorAll(".sp-mine .sp-item-actions button")].find(b=>b.textContent.includes("Редактировать")).click()');await until('!!document.querySelector("#stream-edit-quality")&&!document.querySelector("#stream-edit-quality").disabled');};
 const close=()=>ev('document.querySelector(".pd-x").click()');
 await navigate('actor=owner&grant');await until('document.querySelectorAll(".sp-mine .sp-item").length===7');
 await ev('[...document.querySelectorAll(".sp-card-head button")].find(b=>b.textContent.includes("Запланировать")).click()');await until('!!document.querySelector("#stream-create-quality")');
 assert.equal(await ev('document.querySelectorAll("#stream-create-quality option[value=full_hd]").length'),0);results.push('new streams start in HD; no global Full HD choice during creation');
 await ev('[...document.querySelectorAll("form button")].find(b=>b.textContent.includes("Отменить")).click()');
 await openEdit('Скрытые');assert.equal(await ev('document.querySelectorAll("#stream-edit-quality option[value=full_hd]").length'),1);
 assert(await ev('document.querySelector(".pd-dialog").textContent.includes("тестовый режим только для этого эфира")'));results.push('only the designated owner/stream sees experimental Full HD and quality disclaimer');
 await ev('var qualitySelect=document.querySelector("#stream-edit-quality");qualitySelect.value="full_hd";qualitySelect.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector(".pd-dialog__foot .pd-btn:not(.pd-btn--ghost)").click()');await until('fixture.updates.length===1');assert.equal(await ev('fixture.updates[0].patch.video_quality'),'full_hd');results.push('authorized selection is rechecked and saved through existing update API');await close();
 await openEdit('Публичные');assert.equal(await ev('document.querySelectorAll("#stream-edit-quality option[value=full_hd]").length'),0);results.push('grant cannot be reused for another stream of the same owner');await close();
 await ev('fixture.grant=false');await openEdit('Скрытые');assert.equal(await ev('document.querySelector("#stream-edit-quality").value'),'hd');assert.equal(await ev('fixture.rows.find(s=>s.id==="unlisted-scheduled").video_quality'),'full_hd');assert.equal(await ev('fixture.updates.length'),1);results.push('revoked saved preference shows HD without silently modifying DB or live snapshot');await close();
 await ev('fixture.grant=true');await openEdit('Скрытые');await ev('var qualitySelect=document.querySelector("#stream-edit-quality");qualitySelect.value="full_hd";qualitySelect.dispatchEvent(new Event("change",{bubbles:true}));fixture.grant=false;document.querySelector(".pd-dialog__foot .pd-btn:not(.pd-btn--ghost)").click()');await until('document.querySelector(".pd-dialog").textContent.includes("Тестовый допуск Full HD недоступен")');assert.equal(await ev('fixture.updates.length'),1);results.push('revocation while editing prevents Full HD save');await close();
 await ev('fixture.rpcFail=true');await openEdit('Скрытые');assert.equal(await ev('document.querySelectorAll("#stream-edit-quality option[value=full_hd]").length'),0);results.push('permission API failure fails closed');await close();
 await ev('fixture.rpcFail=false;fixture.grant="pending"');await filter('Скрытые');await ev('[...document.querySelectorAll(".sp-mine .sp-item-actions button")].find(b=>b.textContent.includes("Редактировать")).click()');await until('typeof window.releaseCapability==="function"');assert(await ev('document.querySelector("#stream-edit-quality").disabled'));await close();await openEdit('Публичные');await ev('releaseCapability({data:{version:2,full_hd_allowed:true},error:null})');await new Promise(r=>setTimeout(r,30));assert.equal(await ev('document.querySelectorAll("#stream-edit-quality option[value=full_hd]").length'),0);results.push('late permission response cannot enable Full HD in another dialog');
 for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);assert(await ev('document.documentElement.scrollWidth<=innerWidth'));const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(work,'full-hd-'+width+'.png'),Buffer.from(shot.data,'base64'));results.push('responsive quality form '+width);}
 await navigate('actor=other&grant');await until('document.querySelectorAll(".sp-mine .sp-item").length===1');await openEdit('Скрытые');assert.equal(await ev('document.querySelectorAll("#stream-edit-quality option[value=full_hd]").length'),0);results.push('another organizer does not inherit the pilot choice');
 console.log(JSON.stringify({pass:results.length,fail:0,results,artifacts:work}));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
