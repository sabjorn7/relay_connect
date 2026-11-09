// Real Vue components, synthetic local Embed API only. No real cameras, API, room or payment.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'meetguru-quality-ui-')));
fs.symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),'dir');
fs.writeFileSync(path.join(work,'index.html'),'<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>');
fs.writeFileSync(path.join(work,'main.js'),`import {createApp,ref} from 'vue';
import Field from ${JSON.stringify(path.join(root,'src/_front/components/StreamQualityField.vue'))};
import Viewer from ${JSON.stringify(path.join(root,'src/_front/components/StreamViewer.vue'))};
import Diag from ${JSON.stringify(path.join(root,'src/_front/components/StreamDiagnostics.vue'))};
createApp({components:{Field,Viewer,Diag},setup(){const q=ref('hd'),supported=ref(true);return {q,supported,room:{state:'connected',localParticipant:{isCameraEnabled:true,getTrackPublication(){return {track:{mediaStreamTrack:{label:'Synthetic camera',getSettings(){return {width:1280,height:720,frameRate:30}}},getRTCStatsReport:async()=>new Map()}}}}}}},template:${JSON.stringify(`<main style="max-width:900px;margin:auto;font-family:Arial"><Field id="quality" v-model="q" full-hd-enabled live/><p id="selected">{{q}}</p><button id="unsupported" @click="supported=false">Unsupported API</button><Viewer :key="supported" :src="supported?'/frame':'/frame?unsupported=1'"/><Diag :room="room" :profile="q"/></main>`)}}).mount('#app');`);
await build({root:work,configFile:false,plugins:[vue()],logLevel:'error',build:{outDir:'dist'},resolve:{alias:{'@':path.join(root,'src'),'vue':path.join(root,'node_modules/vue/dist/vue.esm-bundler.js')}}});
const results=[];let browser,ws;
const layoutSource=fs.readFileSync(path.join(root,'reviews/2026-11-09-stream-quality/template/grid.html'),'utf8');
const layoutStyle=layoutSource.match(/<style>([\s\S]*?)<\/style>/)[1];
const layoutCode=layoutSource.slice(layoutSource.indexOf("        const grid = document.getElementById('grid');"),layoutSource.indexOf('        (async () =>'));
const frame=`<html><body style="background:#15233e;color:white">Synthetic stream<script>
let current=-1;const rows=()=>[{id:-1,height:0,active:current===-1},{id:7,height:1080,active:current===7},{id:4,height:720,active:current===4}];
window.addEventListener('message',e=>{if(location.search.includes('unsupported'))return;let m;try{m=JSON.parse(e.data)}catch{return}const send=x=>parent.postMessage(JSON.stringify(x),location.origin);
if(m.method==='peertube::__ready'){if(m.params==='ping')send({method:'peertube::__ready',params:'pong'});return;}
if(!m.id)return;let result;if(m.method==='peertube::isReady')result=true;if(m.method==='peertube::getResolutions')result=rows();if(m.method==='peertube::setResolution'){current=m.params;result=null;}send({id:m.id,result});});</script></body></html>`;
const server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:");
    if(req.url==='/layout'){res.setHeader('Content-Type','text/html');res.end('<html><style>'+layoutStyle+'</style><div id="grid"></div><script>'+layoutCode+'</script></html>');return;}
    if(req.url.startsWith('/frame')){res.setHeader('Content-Type','text/html');res.end(frame);return;}
    const name=path.join(work,'dist',req.url==='/'?'index.html':req.url.split('?')[0]);
    if(!name.startsWith(path.join(work,'dist')+path.sep)||!fs.existsSync(name)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(name));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
try{
    browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--user-data-dir='+path.join(work,'profile'),'about:blank'],{stdio:['ignore','ignore','pipe']});
    const address=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Chrome timeout')),15000);browser.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});browser.on('exit',()=>reject(Error('Chrome unavailable')));});
    ws=new WebSocket(address);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
    let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')console.log('FIXTURE EXCEPTION',m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')console.log('FIXTURE ERROR',m.params.args.map(x=>x.value).join(' '));});
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});ws.send(JSON.stringify({id:next,method,params,...(sessionId?{sessionId}:{})}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
    await send('Page.enable',{},sessionId);await send('Network.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
    // CSP blocks every external connect/frame; resolver blocks external hostnames; fresh profile has no SW.
    await send('Network.setBlockedURLs',{urls:['https://*','wss://*','ws://*']},sessionId);
    await send('Page.navigate',{url:origin},sessionId);
    const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Fixture condition timeout');};
    try { await until('document.querySelectorAll(".sq-viewer option").length===3'); }
    catch(error){console.log('FIXTURE STATE',await evaluate('JSON.stringify({body:document.body.textContent,src:document.querySelector("iframe")?.src})'));throw error;}
    assert.equal(await evaluate('document.querySelector("#selected").textContent'),'hd');
    results.push({name:'HD default and only advertised viewer resolutions',status:'PASS'});
    await evaluate('document.querySelector("#quality").value="full_hd";document.querySelector("#quality").dispatchEvent(new Event("change",{bubbles:true}))');
    await until('document.querySelector("#selected").textContent==="full_hd"');
    assert(await evaluate('document.body.textContent.includes("ниже выбранного")'));assert(await evaluate('document.body.textContent.includes("следующем запуске")'));
    results.push({name:'Full HD selection, unsupported camera warning, next-start notice',status:'PASS'});
    await evaluate('const s=document.querySelector(".sq-viewer select");s.value="4";s.dispatchEvent(new Event("change",{bubbles:true}));');
    await until('document.querySelector(".sq-viewer").textContent.includes("Текущее качество: 720p")');
    results.push({name:'viewer switches through Embed API to actual 720p ID',status:'PASS'});
    for(const width of [390,1366]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},sessionId);
        assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
        const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(path.join(work,'quality-'+width+'.png'),Buffer.from(shot.data,'base64'));
        results.push({name:'responsive controls width '+width,status:'PASS'});
    }
    await evaluate('document.getElementById("unsupported").click()');
    await until('document.body.textContent.includes("Управление качеством недоступно")');
    assert(await evaluate('!!document.querySelector("iframe")'));results.push({name:'unsupported Embed API keeps original iframe functional',status:'PASS'});
    await send('Page.navigate',{url:origin+'/layout'},sessionId);await until('typeof tileFor==="function"');
    for(const [width,height]of [[1280,720],[1920,1080]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
        await evaluate("for(const k of [...tiles.keys()])removeTile(k);for(let i=0;i<4;i++)tileFor('p'+i+':camera','Synthetic',false);");
        assert.equal(await evaluate('document.querySelectorAll("#grid.gridmode .tile").length'),4);
        await evaluate("tileFor('p0:screen','Synthetic screen',true).appendChild(document.createElement('video'));");
        assert(await evaluate('document.querySelector("#spot").getBoundingClientRect().width>innerWidth*.9'));
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".tile.screen video")).objectFit'),'contain');
        assert.equal(await evaluate('document.querySelectorAll("#strip .tile").length'),4);
        results.push({name:'production-derived Egress grid and screen spotlight '+width+'x'+height,status:'PASS'});
    }
    console.log(JSON.stringify({results,artifacts:work}));
}finally{ws?.close();browser?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
