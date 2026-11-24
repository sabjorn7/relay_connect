// Real Vite /club + WeWeb page, local synthetic APIs only.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('dist'),out=fs.mkdtempSync(path.join(os.tmpdir(),'mg-club-full-'));
const U='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222',A='44444444-4444-4444-8444-444444444444';
const user={id:U,Name:'Тестовый участник',email:'fixture@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{provider:'email'}};
const token=[{alg:'HS256',typ:'JWT'},{sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'synthetic'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const bundle={club:{id:C,owner:{id:A,Name:'Автор клуба',Photo:null},title:'Тестовый клуб',short_descr:'Локальный стенд',descr:'Локальный стенд',label:null,price:3500,sub_id:'123',subs:[]},club_posts:[],later_posts:[],user_sub:{id:'33333333-3333-4333-8333-333333333333',suber:U,club:C,active:true,end_date:'2099-12-31'},subers:[]};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');let p=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return}if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p)){res.writeHead(404).end();return}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream');res.end(fs.readFileSync(p))});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const results=[];
try{for(const engine of (process.env.ENGINES||'Chrome,WebKit').split(',')){
 const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch({headless:true});
 try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',timezoneId:'Europe/Moscow'});
 const requests=[],writes=[],errors=[];let messages=Array.from({length:16},(_,i)=>({id:`55555555-5555-4555-8555-${String(i).padStart(12,'0')}`,club:C,text:`Сообщение ${i+1}: https://example.org/${i}`,img:i===15?['https://fixture.invalid/photo.png']:[],owner:{id:i%2?U:A,Name:i%2?'Тестовый участник':'Автор клуба',Photo:null},created_at:`2026-11-24T12:${String(i).padStart(2,'0')}:00Z`,deleted:false}));
 await context.routeWebSocket('**/*',ws=>ws.close());
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());const api=/\/(rest|auth|functions)\/v1\//.test(u.pathname);
 if(u.origin===origin&&!api&&!u.pathname.startsWith('/_'))return r.continue();
 requests.push(q.method()+' '+u.pathname);let data=[];const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','content-type':'application/json'};
 if(q.method()==='OPTIONS')return r.fulfill({status:200,headers,body:''});
 if(u.hostname==='fixture.invalid')return r.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.resolve('public/images/apple-touch-180.png'))});
 if(u.pathname.includes('/auth/v1/user'))data=user;else if(u.pathname.includes('/auth/v1/token'))data=session;
 else if(u.pathname.endsWith('/get_club_bundle'))data=bundle;
 else if(u.pathname.includes('/rest/v1/users'))data=[user];
 else if(u.pathname.endsWith('/club_chat')){
  if(q.method()==='GET')assert.equal(u.searchParams.get('club'),'eq.'+C,'history query must be scoped to this club');
  if(q.method()==='POST'){const b=q.postDataJSON();writes.push({method:'POST',body:b});const row={...b,id:'66666666-6666-4666-8666-666666666666',owner:{id:U,Name:user.Name},created_at:'2026-11-24T13:00:00Z'};messages.push(row);data=[row]}
  else if(q.method()==='DELETE'){const id=u.searchParams.get('id')?.replace('eq.','');writes.push({method:'DELETE',id});messages=messages.filter(m=>m.id!==id);data=[]}
  else data=messages;
 }else if(u.pathname.startsWith('/_'))data={enabled:false,sampleRate:0};
 return r.fulfill({status:200,headers,body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/club/?club='+C);
 await page.getByText('Тестовый клуб',{exact:true}).first().waitFor({timeout:45000});
 await page.evaluate(async(session)=>{const p=Object.values(window.wwLib.wwPlugins).find(p=>p?.refreshAuthUser&&p?.publicInstance);if(!p)throw Error('missing plugin');await p.publicInstance.auth.setSession(session);await p.refreshAuthUser(session)},session);
 await page.waitForTimeout(800);

 await page.getByText('Чат клуба',{exact:true}).filter({visible:true}).first().click();
 await page.locator('.mg-club-msg:visible').first().waitFor({timeout:15000});
 await page.waitForTimeout(600);
 const scroll=page.locator('[id=chat-scroll]:visible').first();const scrollState=await scroll.evaluate(e=>({height:e.clientHeight,total:e.scrollHeight,top:e.scrollTop}));console.log(JSON.stringify({engine,width,scrollState}));assert(scrollState.total>scrollState.height);assert(scrollState.top+scrollState.height>=scrollState.total-4,'initial history should land at bottom');
 await scroll.evaluate(e=>e.scrollTop=0);assert.equal(await scroll.evaluate(e=>e.scrollTop),0);await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);
 await page.screenshot({path:path.join(out,engine+'-'+width+'-before.png'),fullPage:true});
 console.log(JSON.stringify({stage:'rendered',engine,width,messageCount:await page.locator('.mg-club-msg:visible').count(),textareas:await page.locator('textarea:visible').count(),buttons:await page.locator('button:visible').allTextContents(),errors}));
 assert.equal(await page.locator('.mg-club-msg:visible').count(),16);
 const input=page.locator('textarea:visible').last();await input.fill('Проверка отправки');
 // Continue exact sender action after inspecting the actual rendered WeWeb composer.
 const send=page.getByText('Отправить',{exact:true}).filter({visible:true}).last();await send.click();
 await page.getByText('Проверка отправки',{exact:true}).filter({visible:true}).waitFor();
 assert.equal(writes.filter(w=>w.method==='POST').length,1);assert.equal(writes[0].body.club,C);assert.equal(writes[0].body.owner,U);
 await page.getByRole('button',{name:'Удалить своё сообщение'}).filter({visible:true}).last().click();
 await page.getByText('Удалить',{exact:true}).filter({visible:true}).last().click();
 await page.waitForTimeout(500);assert.equal(writes.filter(w=>w.method==='DELETE').length,1);
 await page.getByRole('button',{name:'Открыть фото 1'}).filter({visible:true}).last().click();await page.waitForTimeout(200);
 assert(await page.locator('img[src="https://fixture.invalid/photo.png"]:visible').count()>=2,'real gallery popup should display photo');
 await page.screenshot({path:path.join(out,engine+'-'+width+'-photo.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 results.push({engine,width,history:true,sent:true,deleted:true,photoOpened:true,errors});await context.close();
 }}finally{await browser.close()}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({results,out}));
