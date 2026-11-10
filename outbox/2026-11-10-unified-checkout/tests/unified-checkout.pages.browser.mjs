// Real AppHeader/CheckoutOrders and course/cart clients. Synthetic RPC boundary; no provider or production calls.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {build} from 'vite';import vue from '@vitejs/plugin-vue';
const root=path.resolve(new URL('..',import.meta.url).pathname),work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-checkout-pages-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
const account=path.join(root,'src/_front/chrome/headerAccount.js');
const mocks={
 'streams/peertubeLive.js':`export const VIDEO_STATE={PUBLISHED:1,LIVE_ENDED:5};export const getVideoInfo=async()=>({stateId:1,state:{id:1},isLive:false}),assetUrl=x=>x,embedUrl=()=>'/local-frame';export const createLive=()=>{throw Error('no live writes')},getLiveCredentials=createLive,deleteLive=createLive;`,
 'chrome/errorLogger.js':`export const logClientEvent=()=>{};`,
 'components/PushToggle.vue':`export default {render(){return null}};`,
 'components/StreamDiagnostics.vue':`export default {render(){return null}};`,
 'components/StreamViewer.vue':`export default {template:'<div data-synthetic-player>Local player boundary</div>'};`,

 'chrome/headerAccount.js':`export * from 'actual-account';export const getSupabase=()=>window.fixture.sb,loadUser=async()=>window.fixture.user,waitForUid=async()=>window.fixture.user?.id,readStoredSession=()=>window.fixture.user?{user:window.fixture.user}:null,authCookieUser=()=>null;`,
 'chrome/unread.js':`import {ref} from 'vue';export const hasUnread=ref(false),initUnread=()=>{},resetUnread=()=>{};`
};
fs.writeFileSync(path.join(work,'index.html'),'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>');
fs.writeFileSync(path.join(work,'main.js'),`
import {createApp} from 'vue';import {createRouter,createWebHistory} from 'vue-router';
import Header from ${JSON.stringify(path.join(root,'src/_front/chrome/AppHeader.vue'))};
import Course from ${JSON.stringify(path.join(root,'src/_front/views/CoursePage.vue'))};
import Events from ${JSON.stringify(path.join(root,'src/_front/views/EventsPage.vue'))};
import Streams from ${JSON.stringify(path.join(root,'src/_front/views/StreamsPage.vue'))};
import {addProduct,openSharedCart} from ${JSON.stringify(path.join(root,'src/_front/checkout/cartApi.js'))};
import {addToCart,enrollFree} from ${JSON.stringify(path.join(root,'src/_front/course/coursesApi.js'))};
const f=window.fixture={user:{id:'10000000-0000-4000-8000-000000000001',Name:'Synthetic buyer'},cart:[],calls:[],invokes:[],orders:[],failCart:false};
const q=new URLSearchParams(location.search);f.user=q.has('guest')?null:f.user;
let seq=0;const id=()=>('00000000-0000-4000-8000-'+String(++seq).padStart(12,'0'));
f.c='20000000-0000-4000-8000-000000000001';f.e='20000000-0000-4000-8000-000000000002';f.t='20000000-0000-4000-8000-000000000003';
f.products={course:[{id:f.c,slug:'synthetic',Title:'Synthetic course',Price:1000,Free:false,DurationLong:6,DurationPrice:0,ModStatus:'Опубликовано',Less_Id:[],owner:'author'}],events:[{id:f.e,slug:'synthetic',title:'Synthetic event',price:q.has('free')?0:2000,capacity:0,deposit_percent:25,status:'published',owner:'author'}],streams:[{id:f.t,title:'Synthetic stream',price:q.has('free')?0:3000,status:'scheduled',scheduled_at:'2099-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z',access_months:12,backing_course_id:f.c,author:'author',mode:'multi',visibility:'public',hidden:false}],users:f.user?[f.user]:[],user_course:q.has('owned')&&f.user?[{id:'owned',course:f.c,user:f.user.id,buy:true,Free:false}]:[],event_registrations:q.has('owned')&&f.user?[{id:'reg',event:f.e,user:f.user.id,status:'paid'}]:[]};
if(q.has('incart'))f.cart.push({id:id(),product_type:location.pathname.includes('event')?'event':'stream',product_id:location.pathname.includes('event')?f.e:f.t,course_name:'Existing product',price:2000});
f.sb={auth:{getSession:async()=>({data:{session:f.user?{user:f.user}:null}})},from(table){let rows=f.products[table]||[];const chain={select(){return this},eq(k,v){rows=rows.filter(x=>x[k]===v);return this},in(k,v){rows=rows.filter(x=>v.includes(x[k]));return this},or(){rows=rows.filter(x=>x.buy||x.Free);return this},order(){return this},limit(n){rows=rows.slice(0,n);return this},update(){return this},then(resolve){return Promise.resolve({data:structuredClone(rows),count:rows.length,error:null}).then(resolve)}};return chain;},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){},rpc:async(name,args={})=>{
 f.calls.push({name,args});if(name==='cart_get')return f.failCart?{error:{message:'synthetic'}}:{data:structuredClone(f.cart)};
 if(name==='cart_add_product'){const row={id:id(),course_name:{course:'Course',event:'Event',stream:'Stream'}[args.p_type],product_type:args.p_type,product_id:args.p_product_id,price:{course:1000,event:2000,stream:3000}[args.p_type],payment_type:args.p_payment_type,available:true};f.cart.push(row);return {data:row};}
 if(name==='cart_remove'){f.cart=f.cart.filter(x=>x.id!==args.p_shop_id);return {data:null};}
 if(name==='cart_quote')return {data:args.p_code==='GOOD'?{valid:true,code:'GOOD',discount:600,new_total:5400}:{valid:false,reason:'not_applicable'}};
 if(name==='checkout_my_orders')return {data:structuredClone(f.orders)};
 if(name==='checkout_register_free_event'){f.products.event_registrations.push({id:id(),event:args.p_event_id,user:f.user.id,status:'paid'});return {data:null};}
 if(name==='stream_visibility_capabilities')return {data:{version:2,unlisted_enabled:true}};
 if(name==='stream_video_quality_capabilities')return {data:{version:1,full_hd_enabled:false}};
 if(name==='checkout_cancel'){f.orders=f.orders.map(x=>({...x,status:'cancelled'}));return {data:null};}
 return {data:id()};
},functions:{invoke:async(name,{body})=>{f.invokes.push({name,body});return {error:{message:'Synthetic provider stopped before navigation'}};}}};
f.add=async type=>{if(type==='course')await addToCart(f.sb,{buyer:f.user,course:{id:id()}});else await addProduct(f.sb,{type,id:id(),agreed:type==='event'});openSharedCart();};f.free=()=>enrollFree(f.sb,{course:{id:id()}});
window.wwLib={wwPlugins:{supabase:{instance:f.sb}}};
const router=createRouter({history:createWebHistory(),routes:[{path:'/course/:slug',component:Course},{path:'/events',component:Events},{path:'/event/:slug',component:Events},{path:'/streams',component:Streams}]});f.router=router;createApp({components:{Header},template:'<Header/><router-view :key="$route.fullPath"/>'}).use(router).mount('#app');
`);
await build({root:work,configFile:false,plugins:[{name:'synthetic-auth',enforce:'pre',resolveId(id,importer){if(id.startsWith('.')&&importer&&!importer.startsWith('\0'))id=path.resolve(path.dirname(importer),id);if(id==='actual-account')return '\0real-account';const key=Object.keys(mocks).find(k=>id.endsWith('/_front/'+k));if(key)return '\0mock:'+key;},load(id){if(id==='\0real-account')return fs.readFileSync(account,'utf8');if(id.startsWith('\0mock:'))return mocks[id.slice(6)];}},vue({template:{transformAssetUrls:false}})],logLevel:'error',resolve:{alias:{'@':path.join(root,'src'),'vue':path.join(root,'node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:");const rel=req.url.split('?')[0];const file=path.join(work,'dist',rel.startsWith('/assets/')?rel:'index.html');if(!file.startsWith(path.join(work,'dist')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
let browser,ws;const results=[],exceptions=[];
try{
 browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+path.join(work,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((resolve,reject)=>{let s='';const t=setTimeout(()=>reject(Error('Chrome timeout')),15000);browser.stderr.on('data',b=>{s+=b;const m=s.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);resolve(m[1]);}});browser.on('exit',()=>reject(Error('Chrome exited')));});
 ws=new WebSocket(address);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
 const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await send('Runtime.enable',{},sessionId);await send('Page.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Network.setBlockedURLs',{urls:['https://*','wss://*','ws://*']},sessionId);
 const until=async expression=>{for(let i=0;i<100;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Condition timed out: '+expression);};


 const nav=async url=>{await send('Page.navigate',{url:origin+url},sessionId);await until('!!window.fixture&&!!document.querySelector(".mgh")');};
 const addCalls=()=>ev('fixture.calls.filter(x=>x.name==="cart_add_product")');
 const click=async selector=>{await until(`!!document.querySelector('${selector}')`);await ev(`document.querySelector('${selector}').click()`);};
 await nav('/course/synthetic');await until('[...document.querySelectorAll(".pd-buycard button")].some(b=>b.textContent.includes("Добавить в корзину"))');
 await click('.pd-buycard button');await until('fixture.cart.length===1');await until('document.querySelector(".pd-buycard button").textContent.trim()==="В корзине"');
 assert.equal(await ev('location.pathname'),'/course/synthetic');assert.equal(await ev('!!document.querySelector(".mgh__dd--cart")'),false);assert.equal(await ev('fixture.invokes.length'),0);results.push('real CoursePage add stays on page, label changes, checkout/cart not opened');
 await ev('fixture.router.push("/event/synthetic")');await until('!!document.querySelector(".ed-agree input")');await click('.ed-agree input');await click('.ed .pd-buycard button');await until('fixture.cart.length===2');await until('document.querySelector(".ed .pd-buycard button").textContent.includes("В корзине")');
 assert.equal(await ev('!!document.querySelector(".mgh__dd--cart")'),false);assert.equal(await ev('location.pathname'),'/event/synthetic');assert.equal((await addCalls()).at(-1).args.p_agreed,true);results.push('real event with capacity=0 adds to same cart without navigation or automatic dropdown');
 await ev('fixture.router.push("/streams?stream="+fixture.t)');await until('!!document.querySelector(".sp-buy-btn")');await click('.sp-buy-btn');await until('fixture.cart.length===3');await until('document.querySelector(".sp-buy-btn").textContent.trim()==="В корзине"');assert.equal(await ev('!!document.querySelector(".mgh__dd--cart")'),false);assert.equal(await ev('fixture.invokes.length'),0);results.push('real StreamsPage add stays on page; mixed three products retained across SPA routes');
 await click('.sp-buy-btn');await until('document.querySelectorAll(".mgh__cart-list li").length===3');assert.equal((await addCalls()).length,3);results.push('second click on In cart manually opens existing cart without adding duplicate');
 await click('.mgh__cart-x[aria-label=Убрать]');await until('document.querySelectorAll(".mgh__cart-list li").length===2');results.push('remove a mixed line using existing cart');
 await nav('/event/synthetic?incart');await until('document.querySelector(".ed .pd-buycard button")?.textContent.includes("В корзине")');assert.equal((await addCalls()).length,0);assert.equal(await ev('document.querySelector(".ed .pd-buycard button").disabled'),false);await click('.ed .pd-buycard button');await until('!!document.querySelector(".mgh__dd--cart")');assert.equal((await addCalls()).length,0);results.push('reopening event restores In cart; manual cart opens without renewed agreement or duplicate');
 await nav('/streams?stream=20000000-0000-4000-8000-000000000003&incart');await until('document.querySelector(".sp-buy-btn")?.textContent.trim()==="В корзине"');assert.equal((await addCalls()).length,0);results.push('reopening stream restores server cart state');
 await nav('/event/synthetic?owned');await until('document.querySelector(".ed")?.textContent.includes("Вы записаны")');assert.equal((await addCalls()).length,0);results.push('paid event registration is not offered for repurchase');
 await nav('/streams?stream=20000000-0000-4000-8000-000000000003&owned');await until('!!document.querySelector(".sp-detail-title")&&!document.querySelector(".sp-loading-access")');assert.equal(await ev('!!document.querySelector(".sp-buy-btn")'),false);results.push('existing stream purchase preserves access gate');
 await nav('/event/synthetic?free');await until('!!document.querySelector(".ed-agree input")');await click('.ed-agree input');await click('.ed .pd-buycard button');await until('document.querySelector(".ed")?.textContent.includes("Вы записаны")');assert.equal((await addCalls()).length,0);assert.equal(await ev('fixture.invokes.length'),0);results.push('free event registers without payment or cart');
 await nav('/event/synthetic?guest');await until('document.querySelector(".ed")?.textContent.includes("Войти, чтобы записаться")');assert.equal((await addCalls()).length,0);results.push('guest event keeps existing login gate');
 await nav('/streams?stream=20000000-0000-4000-8000-000000000003&free');await until('!!document.querySelector(".sp-detail-title")&&!document.querySelector(".sp-loading-access")');assert.equal(await ev('!!document.querySelector(".sp-buy-btn")'),false);results.push('free stream needs no checkout');
 assert.deepEqual(exceptions,[]);const report={pass:results.length,fail:0,results,artifacts:work};fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
