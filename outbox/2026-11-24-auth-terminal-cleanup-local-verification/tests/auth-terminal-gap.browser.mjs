// Actual SDK/public Auth APIs + two browser pages. All HTTP is synthetic/local.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'vite';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/mg-n8n-isolated-20261123.JTawGr/node_modules/playwright/index.mjs');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-terminal-browser-')));
fs.symlinkSync(root+'/node_modules',dir+'/node_modules','dir');
fs.writeFileSync(dir+'/index.html','<html><body><h1>Local auth fixture</h1><script type="module" src="/main.js"></script></body></html>');
fs.writeFileSync(dir+'/main.js',`
import {createClient} from '@supabase/supabase-js';
window.events=[];window.arm=0;window.reads=0;window.waitingRead=false;
const storage={
 getItem(key){const snapshot=localStorage.getItem(key);
  if(key==='session' && window.arm && ++window.reads===window.arm){
   window.waitingRead=true;return new Promise(resolve=>window.releaseRead=()=>{window.arm=0;resolve(snapshot)});
  }return snapshot;
 },setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)
};
const fetcher=async(...args)=>{const r=await fetch(...args);
 if(r.status===400||r.status===401){const json=r.json.bind(r);r.json=async()=>{const body=await json();window.reads=0;window.arm=window.pauseRead;return body}}
 return r;
};
window.client=createClient(location.origin+'/mock','synthetic-anon',{auth:{storageKey:'session',storage,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});
client.auth.onAuthStateChange((event,session)=>{events.push({event,uid:session?.user?.id||null})});
await client.auth.initialize();await client.auth.getSession();window.ready=true;
`);
await build({root:dir,configFile:false,logLevel:'silent',build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://local');const f=path.join(dir,'dist',u.pathname==='/'?'index.html':u.pathname);
 if(!f.startsWith(dir+'/dist/')||!fs.existsSync(f)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(f));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const session=(id,rt,ttl=3600)=>{const exp=Math.floor(Date.now()/1000)+ttl;return {access_token:'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:id,exp,iat:exp-3600})).toString('base64url')+'.synthetic',refresh_token:rt,user:{id},expires_at:exp,expires_in:3600,token_type:'bearer'}};
const results=[];
try{
 for(const [engine,launch] of [['Chrome',()=>chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})],['WebKit',()=>webkit.launch({headless:true})]]){
  const browser=await launch();try{
   for(const status of [400,401])for(const pauseRead of [1,2])for(const id of ['B','A']){
    const ctx=await browser.newContext({serviceWorkers:'block'});let loginRequests=0;const errors=[];
    await ctx.addInitScript(s=>{if(!localStorage.getItem('session'))localStorage.setItem('session',JSON.stringify(s))},session('A','rt-A'));
    await ctx.route('**/*',async route=>{
     const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
     if(u.pathname==='/mock/auth/v1/token'){
      if(u.searchParams.get('grant_type')==='password'){loginRequests++;return route.fulfill({json:session(id,'rt-new')})}
      return route.fulfill({status,headers:{'x-supabase-api-version':'2024-01-01'},json:{code:'refresh_token_not_found',message:'synthetic'}});
     }
     if(u.pathname==='/mock/auth/v1/logout')return route.fulfill({json:{}});
     return route.continue();
    });
    const a=await ctx.newPage(),b=await ctx.newPage();for(const p of [a,b])p.on('pageerror',e=>errors.push(e.name));
    await a.goto(origin);await a.waitForFunction(()=>ready);await b.goto(origin);await b.waitForFunction(()=>ready);
    await a.evaluate(({expired,pause})=>{
     localStorage.setItem('session',JSON.stringify(expired));window.pauseRead=pause;window.events=[];
     window.refreshDone=false;client.auth.refreshSession({refresh_token:'rt-A'}).then(result=>{window.refreshError=result.error?.status;window.refreshDone=true});
    },{expired:session('A','rt-A',-10),pause:pauseRead});
    await a.waitForFunction(()=>waitingRead);
    await b.evaluate(()=>{window.loginDone=false;client.auth.signInWithPassword({email:'synthetic@example.test',password:'synthetic-only'}).then(result=>{window.loginError=result.error?.name||null;window.loginDone=true})});
    await b.waitForTimeout(150);
    if(pauseRead===1){await b.waitForFunction(()=>loginDone);assert.equal(await b.evaluate(()=>JSON.parse(localStorage.getItem('session')).refresh_token),'rt-new')}
    else {assert.equal(loginRequests,1);assert.equal(await b.evaluate(()=>loginDone),false,'writer B must wait while terminal cleanup holds the write lock')}
    await a.evaluate(()=>releaseRead());await a.waitForFunction(()=>refreshDone);await b.waitForFunction(()=>loginDone);
    assert.equal(await a.evaluate(()=>refreshError),status);assert.equal(await b.evaluate(()=>loginError),null);
    assert.equal(await a.evaluate(()=>JSON.parse(localStorage.getItem('session')).refresh_token),'rt-new');
    if(pauseRead===1)assert.equal(await a.evaluate(()=>events.filter(e=>e.event==='SIGNED_OUT').length),0);
    const logout=await b.evaluate(async()=>{const r=await client.auth.signOut();return {error:r.error?.name||null,stored:localStorage.getItem('session')}});
    assert.deepEqual(logout,{error:null,stored:null});assert.deepEqual(errors,[]);
    const result={engine,status,pauseRead,successor:id,pass:true};results.push(result);console.log(JSON.stringify(result));await ctx.close();
   }
  }finally{await browser.close()}
 }
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({pass:results.length,results,scope:'real browsers/public SDK/two pages; async storage gates; synthetic HTTP only'}));
