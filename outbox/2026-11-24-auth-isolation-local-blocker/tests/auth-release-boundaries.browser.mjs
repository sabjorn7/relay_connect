// Real old/new SDKs, synthetic HTTP only. Expected risks are recorded, not hidden.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {build} from 'vite';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/mg-n8n-isolated-20261123.JTawGr/node_modules/playwright/index.mjs');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-auth-boundaries-')));
fs.symlinkSync(root+'/node_modules',dir+'/node_modules');
fs.writeFileSync(dir+'/index.html','<script type="module" src="/main.js"></script>');
fs.writeFileSync(dir+'/main.js',`
import {GoTrueClient as Old} from ${JSON.stringify(process.env.OLD_AUTH_MODULE||'/Users/arseny/meetclone/node_modules/@supabase/auth-js/dist/module/index.js')};
import {GoTrueClient as New} from '@supabase/supabase-js';
import {readStoredSession,authCookieUser,signOutUser} from ${JSON.stringify(root+'/src/_front/chrome/headerAccount.js')};
window.readStoredSession=readStoredSession;window.authCookieUser=authCookieUser;window.oldLogout=()=>signOutUser({auth:client});
const old=new URLSearchParams(location.search).has('old');window.key=old?'session':'session:auth-v2';
window.events=[];
const storage={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),
 async removeItem(k){if(old&&window.arm&&k==='session'){window.waiting=true;await new Promise(r=>window.release=r);window.arm=false}localStorage.removeItem(k)}};
window.client=new (old?Old:New)({url:location.origin+'/auth/v1',storageKey:window.key,storage,autoRefreshToken:false,detectSessionInUrl:false});
client.onAuthStateChange((event,s)=>events.push({event,uid:s?.user?.id||null}));
await client.initialize();window.ready=true;
`);
await build({root:dir,configFile:false,logLevel:'silent',build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://x').pathname;const f=path.join(dir,'dist',p==='/'?'index.html':p);if(!f.startsWith(dir+'/dist/')||!fs.existsSync(f)){res.writeHead(404).end();return}res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(f))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const session=id=>({access_token:'synthetic-'+id,refresh_token:'rt-'+id,user:{id},expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'});
const results=[];
try{for(const [engine,launch] of [['Chrome',()=>chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})],['WebKit',()=>webkit.launch()]]){
 const browser=await launch();try{for(const mode of ['mixed-400','mixed-401','no-locks','closed-holder','legacy-header']){
  const ctx=await browser.newContext();await ctx.addInitScript(({s,noLocks})=>{if(!localStorage.getItem('session'))localStorage.setItem('session',JSON.stringify(s));if(noLocks){localStorage.setItem('session:auth-v2',JSON.stringify(s));}if(noLocks)Object.defineProperty(navigator,'locks',{value:undefined,configurable:true})},{s:session('A'),noLocks:mode==='no-locks'});
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname.endsWith('/token'))return route.fulfill(u.searchParams.get('grant_type')==='password'?{json:session('B')}:{status:mode==='mixed-401'?401:400,json:{code:'refresh_token_not_found',message:'synthetic'}});if(u.pathname.endsWith('/logout'))return route.fulfill({json:{}});return route.continue()});
  const a=await ctx.newPage(),b=await ctx.newPage();await a.goto(origin+(mode.startsWith('mixed')?'/?old=1':'/'));await a.waitForFunction(()=>window.ready);await b.goto(origin);await b.waitForFunction(()=>window.ready);
  if(mode.startsWith('mixed')){
   await a.evaluate(()=>{window.arm=true;window.done=false;client.refreshSession({refresh_token:'rt-A'}).then(()=>window.done=true)});await a.waitForFunction(()=>window.waiting);
   await b.evaluate(()=>client.signInWithPassword({email:'test@example.test',password:'synthetic'}));
   const before=await b.evaluate(()=>JSON.parse(localStorage.getItem(window.key))?.user.id);
   await a.evaluate(()=>release());await a.waitForFunction(()=>window.done);
   const after=await b.evaluate(()=>JSON.parse(localStorage.getItem(window.key))?.user.id??null);
   results.push({engine,mode,before,after,status:after==='B'?'PASS':'FAIL',critical:after!=='B'});
  }else if(mode==='no-locks'){
   const result=await b.evaluate(async()=>{try{const r=await client.signOut();return {error:r.error?.message||null,user:JSON.parse(localStorage.getItem(window.key))?.user.id??null}}catch(e){return {error:e.message,user:JSON.parse(localStorage.getItem(window.key))?.user.id??null}}});
   results.push({engine,mode,...result,status:result.user===null?'PASS':'FAIL',critical:result.user!==null});
  }else if(mode==='legacy-header'){
   await b.evaluate(()=>client.signInWithPassword({email:'test@example.test',password:'synthetic'}));
   const sdkUser=await b.evaluate(async()=>(await client.getSession()).data.session?.user.id);
   const headerUser=await b.evaluate(()=>readStoredSession()?.user.id);
   await a.evaluate(()=>oldLogout());
   const after=await b.evaluate(()=>JSON.parse(localStorage.getItem(window.key))?.user.id??null);
   results.push({engine,mode,sdkUser,headerUser,after,status:headerUser===sdkUser?'PASS':'FAIL',critical:headerUser!==sdkUser});
  }else{
   await a.evaluate(()=>{navigator.locks.request('lock:session-write:session:auth-v2',()=>{window.holding=true;return new Promise(()=>{})})});await a.waitForFunction(()=>window.holding);
   await b.evaluate(()=>{window.done=false;client.signInWithPassword({email:'test@example.test',password:'synthetic'}).then(r=>{window.error=r.error?.message||null;window.done=true})});await b.waitForTimeout(100);const blocked=await b.evaluate(()=>!window.done);
   await a.close();await b.waitForFunction(()=>window.done);const user=await b.evaluate(()=>JSON.parse(localStorage.getItem(window.key))?.user.id??null);
   results.push({engine,mode,blocked,user,status:blocked&&user==='B'?'PASS':'FAIL'});
  }
  console.log(JSON.stringify(results.at(-1)));await ctx.close();
 }}finally{await browser.close()}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({results,releaseReady:!results.some(r=>r.status==='FAIL')}));
