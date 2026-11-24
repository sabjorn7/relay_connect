import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mg-club-ui-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
const put=(n,s)=>{const p=path.join(work,n);fs.writeFileSync(p,s);return p};
const aliases=[
 {find:'@/_front/chrome/headerAccount.js',replacement:put('account.js',`export const readStoredSession=()=>window.fixture.identity.uid?{user:{id:window.fixture.identity.uid}}:null;`)},
 {find:path.join(root,'src/_front/chrome/headerAccount.js'),replacement:path.join(work,'account.js')},
 {find:'@/_front/helpers/chatPreviewData.js',replacement:put('preview.js',`export const loadChatPreview=async()=>({type:'course',title:'Тестовый курс',description:'Публичное описание курса',href:'/course/33333333-3333-4333-8333-333333333333'});`)},
 {find:'@',replacement:path.join(root,'src')},
];
// Relative headerAccount import is matched by Vite after resolution via a tiny test plugin.
put('index.html','<html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>');
put('main.js',`
import {createApp,reactive,provide,h} from 'vue';import {createPinia} from 'pinia';import {usePopupStore} from ${JSON.stringify(path.join(root,'src/pinia/popup.js'))};import Message from ${JSON.stringify(path.join(root,'src/_front/components/ClubChatMessage.vue'))};
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const identity=reactive({uid:A});const rows=reactive([
{id:'one',owner:{id:B,Name:'Анна Смирнова'},text:'Привет! https://example.org/?a=1&b=2,\\nСохраняем  пробелы и переносы.',created_at:'2026-11-24T12:00:00Z'},
{id:'two',owner:{id:A,Name:'Иван Петров'},text:'Вот материал: https://app.meetgu.ru/course/33333333-3333-4333-8333-333333333333',created_at:'2026-11-24T12:01:00Z'},
{id:'three',owner:{id:B},text:'<img src=x onerror="window.pwned=1"> javascript:alert(1)',img:['https://fixture.test/image.png','javascript:alert(1)'],created_at:'2026-11-24T12:02:00Z'},
{id:'four',owner:{id:B},text:'SECRET DELETED',img:['https://fixture.test/deleted.png'],deleted:true,created_at:'2026-11-24T12:03:00Z'}]);
window.fixture={identity,rows};window.wwLib={$store:{getters:{'libraries/getLibrary':{id:'test'},'libraries/getComponents':{}}}};
const Row={props:['row'],setup(p){provide('bindingContext',reactive({get data(){return p.row}}));return()=>h(Message)}};
createApp({setup(){window.fixture.popups=usePopupStore();return()=>h('main',{style:'max-width:940px;margin:auto;background:#f1f6fd;border-radius:16px;padding:8px'},[h('h1',{style:'font:600 20px system-ui;padding:12px'},'Чат клуба'),...rows.map(row=>h(Row,{row,key:row.id}))])}}).use(createPinia()).mount('#app');
`);
await build({root:work,configFile:false,logLevel:'silent',plugins:[{name:'test-account',enforce:'pre',resolveId(id,importer){if(id==='../helpers/chatPreviewData.js'&&importer?.endsWith('ChatLinkPreview.vue'))return path.join(work,'preview.js');if(id==='../chrome/headerAccount.js'&&importer?.endsWith('ClubChatMessage.vue'))return path.join(work,'account.js')}},vue({template:{transformAssetUrls:false}})],resolve:{alias:aliases},build:{outDir:'dist'}});
const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');const p=path.join(work,'dist',url.pathname==='/'?'index.html':url.pathname);if(!p.startsWith(work+'/dist/')||!fs.existsSync(p)){res.writeHead(404);return res.end()}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,results=[];
try{for(const engine of ['Chrome','WebKit']){
 const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch({headless:true});
 try{for(const width of [390,1280]){
 const c=await browser.newContext({viewport:{width,height:900},timezoneId:'Europe/Moscow',serviceWorkers:'block'});
 await c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.fulfill({status:200,body:fs.readFileSync(path.join(root,'public/images/apple-touch-180.png')),contentType:'image/png'}));
 const page=await c.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('.mg-club-msg').nth(3).waitFor();
 assert.equal(await page.locator('.mg-club-msg').count(),4);assert.equal(await page.locator('.mg-club-msg__text').first().textContent(),'Привет! https://example.org/?a=1&b=2,\nСохраняем  пробелы и переносы.');
 assert.equal(await page.locator('.mg-club-msg__time').first().textContent(),'24.11.2026 · 15:00');
 assert.equal(await page.locator('.is-mine').count(),1);assert.equal(await page.locator('.mg-club-msg__delete').count(),1);
 assert.equal(await page.locator('.mg-club-msg__sender').first().getAttribute('href'),'/profile_page?user=22222222-2222-4222-8222-222222222222');
 assert.equal(await page.locator('.mg-club-msg__sender').nth(2).textContent(),'Участник');
 assert.equal(await page.locator('.mg-club-msg__text img, .mg-club-msg__text script').count(),0);assert.equal(await page.evaluate(()=>window.pwned),undefined);
 assert.equal(await page.getByText('SECRET DELETED').count(),0);assert.equal(await page.locator('.mg-club-msg__images button').count(),1);
 await page.getByRole('button',{name:'Открыть фото 1'}).click();assert.equal(await page.evaluate(()=>Object.values(fixture.popups.instances)[0].libraryComponentBaseId),'bdbce13b-c53c-49c0-90cb-d54f062291c6');
 await page.getByRole('button',{name:'Удалить своё сообщение'}).click();assert.equal(await page.evaluate(()=>Object.values(fixture.popups.instances).at(-1).content.default['53525e42-bc4d-43d4-a441-187613868fe2']),'two');
 await page.locator('.pd-preview').waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(work,engine+'-'+width+'.png'),fullPage:true});
 await page.evaluate(()=>fixture.identity.uid=null);assert.equal(await page.locator('.is-mine').count(),0);assert.equal(await page.locator('.mg-club-msg__delete').count(),0);
 assert.deepEqual(errors,[]);results.push({engine,width,links:true,preview:true,legacyGallery:true,legacyDeletePopup:true,logout:true,xssSafe:true,noOverflow:true});await c.close();
 }}finally{await browser.close()}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({pass:results.length,results,screenshots:work}));
