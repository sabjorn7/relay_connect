// Actual plugin + SDK, two browser tabs/Web Locks; only local HTTP mocks.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';import {build} from 'vite';const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'/private/tmp/mg-n8n-isolated-20261123.JTawGr/node_modules/playwright/index.mjs');
const root=path.resolve(new URL('..',import.meta.url).pathname),dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-session-recovery-')));fs.symlinkSync(root+'/node_modules',dir+'/node_modules','dir');
const write=(f,s)=>{fs.writeFileSync(dir+'/'+f,s);return dir+'/'+f};
write('index.html','<html><body><h1>Public interface</h1><div id="private"></div><script type="module" src="/main.js"></script></body></html>');
write('environment.js',`export const getCurrentSupabaseSettings=()=>({projectUrl:location.origin+'/mock',publicApiKey:'synthetic-anon'});export const resolveRuntimeProjectUrl=c=>c.projectUrl;`);
write('diagnostic.js','export const instrumentAuth=()=>{};');write('logger.js','export const logClientEvent=()=>{};');
write('main.js',`
import Plugin from ${JSON.stringify(root+'/src/components/plugins/plugin-1fa0dd68-5069-436c-9a7d-3b54c340f1fa/src/wwPlugin.js')};
import {observeConfirmedSession} from ${JSON.stringify(root+'/src/_front/chrome/confirmedSession.js')};
import {signOutUser,readStoredSession,authCookieUser} from ${JSON.stringify(process.env.HEADER_MODULE||root+'/src/_front/chrome/headerAccount.js')};
import {readStoredSession as oldRead, signOutUser as oldLogout} from '/private/tmp/mg-auth-isolation-20261124/candidate/src/_front/chrome/headerAccount.js';
import {GoTrueClient as Old} from '/Users/arseny/meetclone/node_modules/@supabase/auth-js/dist/module/index.js';
window.headerSession=readStoredSession;window.cookieIdentity=authCookieUser;window.oldRead=oldRead;window.oldLogout=()=>oldLogout(client);
window.vm={config:{globalProperties:{$cookie:{setCookie(){},removeCookie(){}}}}};
const plugin=window.plugin={...Plugin,id:'test',settings:{publicData:{}}};
window.wwLib={manager:false,wwVariable:{getValue:()=>null},wwWebsiteData:{getInfo:()=>({id:'test'})},wwPlugins:{supabaseAuth:plugin},wwLog:{error(){}}};
if(new URLSearchParams(location.search).has('legacy')){window.wwLib={};window.client={auth:new Old({url:location.origin+'/mock/auth/v1',storageKey:'test',autoRefreshToken:false,detectSessionInUrl:false})};await client.auth.initialize();window.ready=true;}else{
await plugin.load();window.client=plugin.publicInstance;
window.observer=observeConfirmedSession(client,id=>{document.querySelector('#private').textContent=id||''});observer.refresh();
window.logout=()=>signOutUser(client);
window.login=()=>plugin.signInEmail({email:'synthetic@example.test',password:'synthetic-password'});
await plugin._initAuth();window.ready=true;}
`);
await build({root:dir,configFile:false,logLevel:'silent',resolve:{alias:[{find:'./helpers/environmentConfig',replacement:dir+'/environment.js'},{find:'@/_front/chrome/sessionDiagnostic.js',replacement:dir+'/diagnostic.js'},{find:'@/_front/chrome/errorLogger.js',replacement:dir+'/logger.js'},{find:'@',replacement:root+'/src'}]},build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/empty'){res.setHeader('Content-Type','text/html');return res.end('<html><body>holder</body></html>')}const f=path.join(dir,'dist',u.pathname==='/'?'index.html':u.pathname);if(!f.startsWith(dir+'/dist/')||!fs.existsSync(f)){res.writeHead(404);return res.end()}res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(f))});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const makeSession=(uid='A',rt='rt-A',age=0)=>{const exp=Math.floor(Date.now()/1000)+3600-age;const payload=Buffer.from(JSON.stringify({sub:uid,exp,iat:exp-3600})).toString('base64url');return {access_token:'eyJhbGciOiJIUzI1NiJ9.'+payload+'.synthetic',refresh_token:rt,expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}}};
const results=[];
try{for(const engine of ['Chrome','WebKit']){const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch();try{
for(const mode of (process.env.MODES?.split(',')||['identity','logout','logout-500','logout-offline','no-locks','legacy-scanner'])){
 const ctx=await browser.newContext({serviceWorkers:'block'});let revocations=0;
 await ctx.addInitScript(({a,b,noLocks})=>{localStorage.setItem('test',JSON.stringify(a));localStorage.setItem('test:auth-v2','mg-auth-v2:'+btoa(JSON.stringify(b)));document.cookie='sb-access-token='+encodeURIComponent(a.access_token)+'; path=/';if(noLocks)Object.defineProperty(navigator,'locks',{value:undefined})},{a:makeSession('A'),b:makeSession('B','rt-B'),noLocks:mode==='no-locks'});
 await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(u.pathname.endsWith('/logout')){revocations++;if(mode==='logout-offline')return route.abort();return route.fulfill({status:mode==='logout-500'?500:200,json:{}})}return route.continue()});
 const page=await ctx.newPage();await page.goto(origin);await page.waitForFunction(()=>window.ready&&plugin.user?.id==='B');
 const identity=await page.evaluate(()=>({sdk:plugin.user.id,header:headerSession()?.user?.id??null,cookie:cookieIdentity()?.id??null}));
 if(mode==='identity')results.push({engine,mode,...identity,status:identity.header==='B'&&identity.cookie==='B'?'PASS':'FAIL'});
 else if(mode==='legacy-scanner'){
  const legacy=await ctx.newPage();await legacy.goto(origin+'/?legacy=1');await legacy.waitForFunction(()=>window.ready);const oldUser=await legacy.evaluate(()=>oldRead()?.user.id);await legacy.evaluate(()=>oldLogout());const remaining=await page.evaluate(()=>localStorage.getItem('test:auth-v2'));
  results.push({engine,mode,oldUser,newSessionSurvives:!!remaining,status:remaining&&oldUser==='A'?'PASS':'FAIL',note:'legacy scanner remains unchanged'});
 }else{
  await page.evaluate(()=>{window.done=false;window.result=null;logout().then(r=>{window.result={error:!!r?.error,localCleared:r?.localCleared};window.done=true}).catch(()=>{window.result={thrown:true};window.done=true})});
  const hidden=await page.evaluate(()=>headerSession()===null&&plugin.isAuthenticated===false);
  await page.waitForFunction(()=>window.done);const after=await page.evaluate(()=>({result:window.result,old:!!localStorage.getItem('test'),current:!!localStorage.getItem('test:auth-v2')}));
  const errorExpected=mode==='logout-500'||mode==='logout-offline';
  results.push({engine,mode,hidden,...after,revocations,status:hidden&&after.old&&!after.current&&after.result?.error===errorExpected?'PASS':'FAIL'});
 }
 console.log(JSON.stringify(results.at(-1)));await ctx.close();
}
}finally{await browser.close()}}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({results,ready:results.every(r=>r.status==='PASS')}));
