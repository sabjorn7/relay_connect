// Real baseline AppHeader/course cart: direct-table Supabase thenables + preview_promo.
// All writes stay in memory; provider fetch is intercepted before any network call.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {build} from 'vite';import vue from '@vitejs/plugin-vue';
const root=path.resolve(new URL('..',import.meta.url).pathname),work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-checkout-ui-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
const account=path.join(root,'src/_front/chrome/headerAccount.js');
const mocks={
 'chrome/headerAccount.js':`export * from 'actual-account';export const getSupabase=()=>window.fixture.sb,loadUser=async()=>window.fixture.user,waitForUid=async()=>window.fixture.user?.id;`,
 'chrome/unread.js':`import {ref} from 'vue';export const hasUnread=ref(false),initUnread=()=>{},resetUnread=()=>{};`
};
fs.writeFileSync(path.join(work,'index.html'),'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>');
fs.writeFileSync(path.join(work,'main.js'),`
import {createApp} from 'vue';import {createRouter,createWebHistory} from 'vue-router';
import Header from ${JSON.stringify(path.join(root,'src/_front/chrome/AppHeader.vue'))};
import {instrumentRouter} from ${JSON.stringify(path.join(root,'src/_front/chrome/sessionDiagnostic.js'))};
import {addToCart,enrollFree} from ${JSON.stringify(path.join(root,'src/_front/course/coursesApi.js'))};
const f=window.fixture={user:{id:'10000000-0000-4000-8000-000000000001',Name:'Synthetic buyer'},cart:[],calls:[],payCalls:[],orders:[],failCart:false,failOrder:false,provider:'ok'};
let seq=0;const id=()=>('00000000-0000-4000-8000-'+String(++seq).padStart(12,'0'));
const save=()=>sessionStorage.setItem('cart-test',JSON.stringify({calls:f.calls,payCalls:f.payCalls,orders:f.orders}));
f.sb={channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){},from(table){
 let operation='select',value,head=false,limit=null;const filters=[];
 const query={select(_columns,options){head=options?.head===true;return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},limit(n){limit=n;return this;},insert(v){operation='insert';value=v;return this;},update(v){operation='update';value=v;return this;},delete(){operation='delete';return this;},then(resolve,reject){return Promise.resolve().then(()=>{
  f.calls.push({table,operation,value,filters});let rows=table==='shop'?f.cart:table==='order'?f.orders:[];
  const matches=r=>filters.every(([k,v])=>r[k]===v);
  if(table==='shop'&&operation==='select'&&f.failCart)return {data:null,error:{message:'Synthetic cart read failure'}};
  if(table==='order'&&operation==='insert'&&f.failOrder)return {data:null,error:{message:'Synthetic order failure'}};
  if(operation==='insert'){const row={id:id(),...value};rows.push(row);save();return {data:[structuredClone(row)],error:null};}
  if(operation==='update'){for(const row of rows.filter(matches))Object.assign(row,value);save();return {data:null,error:null};}
  if(operation==='delete'){f.cart=f.cart.filter(r=>!matches(r));save();return {data:null,error:null};}
  const data=rows.filter(matches);return {data:head?null:structuredClone(limit===null?data:data.slice(0,limit)),count:data.length,error:null};
 }).then(resolve,reject);}};return query;
},rpc:async(name,args={})=>{
 f.calls.push({name,args});if(name!=='preview_promo')throw Error('Unexpected RPC '+name);
 if(args.p_code!=='GOOD')return {data:{valid:false,reason:'not_applicable'}};
 const rows=f.cart.filter(r=>args.p_shop_ids.includes(r.id));const total=rows.reduce((s,r)=>s+r.price,0);
 return {data:{valid:true,code:'GOOD',promo_id:'20000000-0000-4000-8000-000000000001',discount:total/10,new_total:total*0.9,lines:rows.map(r=>({shop_id:r.id,new_price:r.price*0.9}))}};
}};
const native=window.fetch.bind(window);window.fetch=async(input,options)=>{
 const u=new URL(typeof input==='string'?input:input.url,location.origin);
 if(u.origin===location.origin)return native(input,options);
 if(u.origin!=='https://meetguru.payform.ru')throw Error('External request denied');
 f.payCalls.push(Object.fromEntries(u.searchParams));save();
 return new Response(f.provider==='invalid'?'not-a-link':location.origin+'/paid-fixture',{status:f.provider==='500'?500:200});
};
f.add=async(n=1)=>{await addToCart(f.sb,{buyer:f.user,course:{id:'30000000-0000-4000-8000-'+String(n).padStart(12,'0'),Title:'Course '+n,Price:n*1000}});window.dispatchEvent(new CustomEvent('mg-open-cart'));};
f.free=()=>enrollFree(f.sb,{buyer:f.user,course:{id:'40000000-0000-4000-8000-000000000001'}});
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<main>Mock route boundary</main>'}}]});instrumentRouter(router);createApp({components:{Header},template:'<Header/><router-view/>'}).use(router).mount('#app');
`);
await build({root:work,configFile:false,define:{__MG_DIAGNOSTIC_RELEASE__:JSON.stringify('acb1496')},plugins:[{name:'synthetic-auth',enforce:'pre',resolveId(id,importer){if(id.startsWith('.')&&importer&&!importer.startsWith('\0'))id=path.resolve(path.dirname(importer),id);if(id==='actual-account')return '\0real-account';const key=Object.keys(mocks).find(k=>id.endsWith('/_front/'+k));if(key)return '\0mock:'+key;},load(id){if(id==='\0real-account')return fs.readFileSync(account,'utf8');if(id.startsWith('\0mock:'))return mocks[id.slice(6)];}},vue()],logLevel:'error',resolve:{alias:{'@':path.join(root,'src'),'vue':path.join(root,'node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{if(req.url==='/_t/session-diagnostic.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,enabled:true,sampleRate:1,maxReports:3,thresholdMs:{route:15000,auth:10000,http:20000,page:45000}}));return;}if(req.url.startsWith('/_l/session-v1?')){res.writeHead(204);res.end();return;}res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:");const rel=req.url.split('?')[0];const file=path.join(work,'dist',rel.startsWith('/assets/')?rel:'index.html');if(!file.startsWith(path.join(work,'dist')+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
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

 await send('Page.navigate',{url:origin+'/'},sessionId);await until('!!window.fixture&&!!document.querySelector(".mgh__avatar")');
 await ev('fixture.add(1)');await ev('fixture.add(2)');await until('document.querySelectorAll(".mgh__cart-list li").length===2');
 assert.match(await ev('document.querySelector(".mgh__cart-total").textContent'),/3.000/);results.push('actual direct-table cart: two courses, correct total');
 await ev('fixture.add(1)');assert.equal(await ev('fixture.cart.length'),2);results.push('duplicate add is prevented before insert');
 await ev('document.querySelector(".mgh__cart-x[aria-label=Убрать]").click()');await until('document.querySelectorAll(".mgh__cart-list li").length===1');
 assert(await ev('fixture.calls.some(x=>x.table==="shop"&&x.operation==="delete")'));await ev('fixture.add(1)');await until('fixture.cart.length===2');results.push('remove and re-add use current table contract');
 await ev('fixture.free()');assert(await ev('fixture.calls.some(x=>x.table==="user_course"&&x.operation==="insert"&&x.value.Free===true)'));assert.equal(await ev('fixture.payCalls.length'),0);results.push('free enrollment never calls payment provider');
 const beforeGuest=await ev('fixture.calls.length');await ev('window.__mgGuestAuth=true;fixture.add(3).catch(()=>{});');assert.equal(await ev('fixture.calls.length'),beforeGuest);await ev('window.__mgGuestAuth=false');results.push('guest-network guard blocks writes');
 await ev('var p=document.querySelector(".mgh__promo-row input");p.value="BAD";p.dispatchEvent(new Event("input",{bubbles:true}));');await ev('document.querySelector(".mgh__promo-apply").click()');await until('document.querySelector(".mgh__err")?.textContent.includes("не действует")');results.push('invalid promo cannot be applied');
 await ev('var p=document.querySelector(".mgh__promo-row input");p.value="GOOD";p.dispatchEvent(new Event("input",{bubbles:true}));');await ev('document.querySelector(".mgh__promo-apply").click()');await until('!!document.querySelector(".mgh__promo-on")');assert.match(await ev('document.querySelector(".mgh__dd--cart").textContent'),/2.700/);results.push('preview_promo shown with actual discount');
 assert(await ev('document.querySelector(".mgh__btn--block").disabled'));await ev('document.querySelector(".mgh__agree input").click();fixture.failOrder=true');await ev('document.querySelector(".mgh__btn--block").click()');await until('document.querySelector(".mgh__err")?.textContent.includes("Synthetic order failure")');assert.equal(await ev('fixture.payCalls.length'),0);results.push('terms required; failed order prevents provider call and releases busy');
 await ev('fixture.failOrder=false;fixture.provider="500";document.querySelector(".mgh__btn--block").click()');await until('document.querySelector(".mgh__err")?.textContent.includes("Prodamus (500)")');assert.equal(await ev('fixture.payCalls.length'),1);results.push('provider error shown; no redirect or fulfillment');
 await ev('fixture.provider="invalid";document.querySelector(".mgh__btn--block").click()');await until('document.querySelector(".mgh__err")?.textContent.includes("не ссылку")');results.push('invalid provider response stays on cart');
 for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);assert(await ev('document.documentElement.scrollWidth<=innerWidth'));}results.push('cart usable at mobile and desktop widths');
 await ev('fixture.provider="ok";document.querySelector(".mgh__btn--block").click()');await until('location.pathname==="/paid-fixture"');
 const stored=JSON.parse(await ev('sessionStorage.getItem("cart-test")'));const order=stored.orders.at(-1),payment=stored.payCalls.at(-1);
 assert.equal(payment.order_id,order.id);assert.equal(Number(payment['products[0][price]'])+Number(payment['products[1][price]']),order.summ);assert.match(order.pageUrl,/^http:\/\/127.0.0.1:[0-9]+\/paid-fixture$/);assert.equal(order.num,order.id);
 assert.equal(payment.urlSuccess,'https://app.meetgu.ru/');assert(!stored.calls.some(x=>x.name==='checkout_my_orders'));results.push('success persists link and order number, then redirects locally; product sum equals order');
 assert.deepEqual(exceptions,[]);const report={pass:results.length,fail:0,results,artifacts:work};fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
