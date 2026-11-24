import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {build} from 'vite';import vue from '@vitejs/plugin-vue';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-course-auth-fixture-')));
fs.symlinkSync(root+'/node_modules',work+'/node_modules','dir');
const put=(name,body)=>{fs.writeFileSync(work+'/'+name,body);return work+'/'+name};
const source=process.env.BEFORE?execFileSync('git',['show','HEAD:src/_front/views/MyCoursePage.vue'],{encoding:'utf8'}):fs.readFileSync(root+'/src/_front/views/MyCoursePage.vue','utf8');
put('MyCourse.vue',source);
const aliases=[{find:'@/_front/chrome/sessionDiagnostic.js',replacement:put('diag.js',`export const tracePage=(_n,_l,fn)=>fn({wait:(_n,f)=>f(),ready(){}});`)} ,{find:'@/_front/streams/peertubeLive.js',replacement:put('video.js',`export const embedUrl=()=>'';`)},{find:'@/_front/course/certificate.js',replacement:put('cert.js',`export const certNumber=()=>'',certDate=()=>'',certFilename=()=>'',downloadCertificatePdf=()=>{};`)},{find:'@/_front/chrome/errorLogger.js',replacement:put('log.js',`export const logClientEvent=()=>{};`)},{find:'@',replacement:root+'/src'}];
put('index.html','<html><div id="app"></div><script type="module" src="/main.js"></script></html>');
put('main.js',`
import {createApp} from 'vue';import {createRouter,createWebHistory} from 'vue-router';import Page from './MyCourse.vue';
const mode=new URLSearchParams(location.search).get('mode');let attempts=0;
const session={access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'B'}};
localStorage.setItem('fixture-session',JSON.stringify(session));
window.calls=[];const record=t=>{calls.push(t);sessionStorage.setItem('calls',JSON.stringify(calls))};
const sb={auth:{async getSession(){record('session');attempts++;await new Promise(r=>setTimeout(r,200));if(mode==='error'&&attempts===1)return {data:{session:null},error:Error('synthetic offline')};return {data:{session:mode==='guest'?null:session},error:null};}},
from(table){record(table);const row=table==='course'?[{id:'course-1',Title:'Synthetic owned course',Free:false,DurationLong:mode==='expired'?30:0,slug:'fixture',Less_Id:[]}]:table==='user_course'?(mode==='denied'?[]:[{id:'owned',end_period:'2001-01-01',created_at:'2000-01-01'}]):[];const q={select(){return q},eq(){return q},limit(){return q},in(){return q},update(){return q},then(ok,bad){return Promise.resolve({data:row,error:null}).then(ok,bad)}};return q},rpc:async()=>({data:null,error:null})};
window.wwLib={wwPlugins:{supabase:{instance:sb},supabaseAuth:{publicInstance:sb,signOut(){throw Error('No logout allowed')},_getUser:()=>null}}};
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:Page}]});await router.push(location.pathname+location.search);await router.isReady();createApp(Page).use(router).mount('#app');
`);
await build({root:work,configFile:false,plugins:[vue({template:{transformAssetUrls:false}})],resolve:{alias:aliases},logLevel:'silent',build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(u.pathname==='/login'||u.pathname.startsWith('/course/')){res.setHeader('Content-Type','text/html');res.end('<h1>Destination</h1>');return;}const file=path.join(work,'dist',u.pathname==='/'?'index.html':u.pathname);if(!file.startsWith(work+'/dist/')||!fs.existsSync(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{for(const engine of ['Chrome','WebKit']){const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch();try{for(const mode of (process.env.BEFORE?['owned']:['owned','guest','denied','expired','error'])){const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin+'/?course=course-1&mode='+mode);
if(process.env.BEFORE){await page.waitForURL('**/login');assert(await page.evaluate(()=>!!localStorage.getItem('fixture-session')));console.log(JSON.stringify({engine,mode,before:'REPRODUCED: redirected to login with stored session intact'}));}
else if(mode==='guest')await page.waitForURL('**/login');
else if(['denied','expired'].includes(mode))await page.waitForURL('**/course/fixture');
else {if(mode==='error'){await page.getByRole('button',{name:'Повторить'}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('calls')).includes('course')),false);await page.getByRole('button',{name:'Повторить'}).click();}await page.getByRole('heading',{name:'Synthetic owned course'}).waitFor();assert.equal(new URL(page.url()).pathname,'/');assert(await page.evaluate(()=>!!localStorage.getItem('fixture-session')));}
console.log(JSON.stringify({engine,mode,pass:true}));await page.close();}}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
