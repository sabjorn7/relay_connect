// Real AppHeader/CheckoutOrders and course/cart clients. Synthetic RPC boundary; no provider or production calls.
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
import {addProduct,openSharedCart} from ${JSON.stringify(path.join(root,'src/_front/checkout/cartApi.js'))};
import {addToCart,enrollFree} from ${JSON.stringify(path.join(root,'src/_front/course/coursesApi.js'))};
const f=window.fixture={user:{id:'10000000-0000-4000-8000-000000000001',Name:'Synthetic buyer'},cart:[],calls:[],invokes:[],orders:[],failCart:false};
let seq=0;const id=()=>('00000000-0000-4000-8000-'+String(++seq).padStart(12,'0'));
f.sb={channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){},rpc:async(name,args={})=>{
 f.calls.push({name,args});if(name==='cart_get')return f.failCart?{error:{message:'synthetic'}}:{data:structuredClone(f.cart)};
 if(name==='cart_add_product'){const row={id:id(),course_name:{course:'Course',event:'Event',stream:'Stream'}[args.p_type],product_type:args.p_type,price:{course:1000,event:2000,stream:3000}[args.p_type],payment_type:args.p_payment_type,available:true};f.cart.push(row);return {data:row};}
 if(name==='cart_remove'){f.cart=f.cart.filter(x=>x.id!==args.p_shop_id);return {data:null};}
 if(name==='cart_quote')return {data:args.p_code==='GOOD'?{valid:true,code:'GOOD',discount:600,new_total:5400}:{valid:false,reason:'not_applicable'}};
 if(name==='checkout_my_orders')return {data:structuredClone(f.orders)};
 if(name==='checkout_cancel'){f.orders=f.orders.map(x=>({...x,status:'cancelled'}));return {data:null};}
 return {data:id()};
},functions:{invoke:async(name,{body})=>{f.invokes.push({name,body});return {error:{message:'Synthetic provider stopped before navigation'}};}}};
f.add=async type=>{if(type==='course')await addToCart(f.sb,{buyer:f.user,course:{id:id()}});else await addProduct(f.sb,{type,id:id(),agreed:type==='event'});openSharedCart();};f.free=()=>enrollFree(f.sb,{course:{id:id()}});
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<main>Mock route boundary</main>'}}]});createApp({components:{Header},template:'<Header/><router-view/>'}).use(router).mount('#app');
`);
await build({root:work,configFile:false,plugins:[{name:'synthetic-auth',enforce:'pre',resolveId(id,importer){if(id.startsWith('.')&&importer&&!importer.startsWith('\0'))id=path.resolve(path.dirname(importer),id);if(id==='actual-account')return '\0real-account';const key=Object.keys(mocks).find(k=>id.endsWith('/_front/'+k));if(key)return '\0mock:'+key;},load(id){if(id==='\0real-account')return fs.readFileSync(account,'utf8');if(id.startsWith('\0mock:'))return mocks[id.slice(6)];}},vue()],logLevel:'error',resolve:{alias:{'@':path.join(root,'src'),'vue':path.join(root,'node_modules/vue/dist/vue.esm-bundler.js')}},build:{outDir:'dist'}});
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

 await send('Page.navigate',{url:origin+'/'},sessionId);await until('!!window.fixture&&!!document.querySelector(".mgh__avatar")');
 for(const type of ['course','event','stream'])await ev(`fixture.add('${type}')`);
 await until('document.querySelectorAll(".mgh__cart-list li").length===3');
 assert.deepEqual(await ev('[...document.querySelectorAll(".mgh__cart-name small:first-of-type")].map(x=>x.textContent)'),['Курс','Мероприятие','Трансляция']);results.push('three product types in the existing shared header cart');
 assert.match(await ev('document.querySelector(".mgh__cart-total").textContent'),/6.000/);results.push('one mixed total');
 await ev('var p=document.querySelector(".mgh__promo-row input");p.value="BAD";p.dispatchEvent(new Event("input",{bubbles:true}));');await ev('document.querySelector(".mgh__promo-apply").click()');await until('document.querySelector(".mgh__err")?.textContent.includes("не действует")');results.push('inapplicable promo does not change checkout');
 await ev('var p=document.querySelector(".mgh__promo-row input");p.value="GOOD";p.dispatchEvent(new Event("input",{bubbles:true}));');await ev('document.querySelector(".mgh__promo-apply").click()');await until('!!document.querySelector(".mgh__promo-on")');assert.match(await ev('document.querySelector(".mgh__dd--cart").textContent'),/5.400/);results.push('server promo quote applied once to mixed cart');
 assert(await ev('document.querySelector(".mgh__btn--block").disabled'));await ev('document.querySelector(".mgh__agree input").click()');await ev('document.querySelector(".mgh__btn--block").click()');await until('fixture.invokes.length===1');
 const call=await ev('fixture.invokes[0]');assert.equal(call.name,'checkout-pay-link');assert.equal(call.body.shop_ids.length,3);assert.equal(call.body.promo_code,'GOOD');assert(!('price' in call.body)&&!('owner' in call.body));results.push('single shared checkout, terms required, no client price/buyer');
 await until('!document.querySelector(".mgh__btn--block").disabled');await ev('document.querySelector(".mgh__btn--block").click()');await until('fixture.invokes.length===2');assert.equal(await ev('fixture.invokes[0].body.request_id===fixture.invokes[1].body.request_id'),true);results.push('retry after failed link uses the same intent');
 await ev('document.querySelector(".mgh__cart-x[aria-label=Убрать]").click()');await until('document.querySelectorAll(".mgh__cart-list li").length===2');assert.equal(await ev('!!document.querySelector(".mgh__promo-on")'),false);results.push('remove uses server RPC and invalidates stale promo');
 await ev('fixture.free()');assert.equal(await ev('fixture.calls.at(-1).name'),'checkout_enroll_free_course');assert.equal(await ev('fixture.invokes.length'),2);results.push('free course enrollment never invokes checkout');
 await ev(`fixture.orders=[{order_id:'20000000-0000-4000-8000-000000000001',status:'pending',total:6000,items:[{name:'Mixed pending'}]}];window.dispatchEvent(new CustomEvent('mg-open-cart'));`);
 // remount the orders panel by closing/reopening the dropdown
 await ev('document.querySelector("[aria-label=Корзина]").click()');await ev('document.querySelector("[aria-label=Корзина]").click()');await until('!!document.querySelector(".checkout-orders article")');
 await ev('[...document.querySelectorAll(".checkout-orders button")].find(b=>b.textContent.includes("Продолжить")).click()');await until('fixture.invokes.length===3');assert.equal(await ev('fixture.invokes[2].body.order_id'),'20000000-0000-4000-8000-000000000001');results.push('pending order resumes existing payment instead of a second cart');
 await ev('[...document.querySelectorAll(".checkout-orders button")].find(b=>b.textContent.includes("Отменить")).click()');await until('document.querySelector(".checkout-orders").textContent.includes("Отменён")');results.push('cancel pending order without booking timer');
 for(const width of [390,1366]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);assert(await ev('document.documentElement.scrollWidth<=innerWidth'));const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(work,'cart-'+width+'.png'),Buffer.from(shot.data,'base64'));results.push('responsive shared cart '+width);}
 await ev('fixture.failCart=true;window.dispatchEvent(new CustomEvent("mg-open-cart"))');await until('document.querySelector(".mgh__err")?.textContent.includes("загрузить корзину")');assert.equal(await ev('document.querySelectorAll(".mgh__cart-list li").length'),0);results.push('cart failure has no unsafe legacy checkout fallback');
 assert.deepEqual(exceptions,[]);const report={pass:results.length,fail:0,results,artifacts:work};fs.writeFileSync(path.join(work,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
