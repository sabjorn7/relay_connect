import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {build} from 'vite';import vue from '@vitejs/plugin-vue';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.cwd(),work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-home-return-')));
fs.symlinkSync(root+'/node_modules',work+'/node_modules','dir');
const put=(n,s)=>{fs.writeFileSync(work+'/'+n,s);return work+'/'+n};
put('App.vue',process.env.BEFORE?execFileSync('git',['show','HEAD:src/_front/App.vue'],{encoding:'utf8'}):fs.readFileSync(root+'/src/_front/App.vue','utf8'));
const blank=put('Blank.vue','<template><span /></template>');
const alias=['AppHeader','AppFooter','AuthBanner','InstallPrompt'].map(n=>({find:'@/_front/chrome/'+n+'.vue',replacement:blank}));
alias.push({find:'./streams/uploadQueueState.js',replacement:put('queue.js','export const uploadQueueState=[];')},{find:'./components/UploadQueuePanel.vue',replacement:blank},{find:'@',replacement:root+'/src'});
put('index.html','<html><div id="app"></div><script type="module" src="/main.js"></script></html>');
put('main.js',`
import {createApp} from 'vue';import {createRouter,createWebHistory} from 'vue-router';import App from './App.vue';
const mode=new URLSearchParams(location.search).get('mode');window.calls=0;
const sb={auth:{getSession(){calls++;return new Promise((resolve,reject)=>setTimeout(()=>mode==='error'?reject(Error('synthetic offline')):resolve({data:{session:mode==='user'?{user:{id:'B'},access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600}:null},error:null}),350));}}};
window.wwLib={$store:{getters:{}},wwPlugins:{supabase:{instance:sb},supabaseAuth:{publicInstance:sb,signOut(){},_getUser:()=>null}}};
const router=createRouter({history:createWebHistory(),routes:[{path:'/',component:{template:'<h1>My courses fixture</h1>'}},{path:'/all_course',component:{template:'<h1>Catalog fixture</h1>'}},{path:'/elsewhere',component:{template:'<h1>Another page</h1>'}}]});
await router.push(location.pathname+location.search);await router.isReady();window.router=router;createApp(App).use(router).mount('#app');window.ready=true;
`);
await build({root:work,configFile:false,plugins:[vue()],resolve:{alias},logLevel:'silent',build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');const f=path.join(work,'dist',u.pathname==='/'?'index.html':u.pathname);if(!f.startsWith(work+'/dist/')||!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
try{for(const engine of ['Chrome','WebKit']){const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch();try{for(const mode of (process.env.BEFORE?['user']:['user','guest','error','leave'])){const page=await browser.newPage();await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());await page.goto(origin+'/?mode='+mode);await page.waitForFunction(()=>window.ready);
if(process.env.BEFORE){await page.waitForURL('**/all_course');console.log(JSON.stringify({engine,before:'REPRODUCED: valid SDK session, empty profile -> catalog'}));}
else {if(mode==='leave')await page.evaluate(()=>router.push('/elsewhere'));await page.waitForTimeout(700);assert.equal(new URL(page.url()).pathname,mode==='guest'?'/all_course':mode==='leave'?'/elsewhere':'/');assert.equal(await page.evaluate(()=>calls),1);}
console.log(JSON.stringify({engine,mode,pass:true}));await page.close();}}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
