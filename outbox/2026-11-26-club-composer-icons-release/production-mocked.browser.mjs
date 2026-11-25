// Real Vite /club + WeWeb page, local synthetic APIs only.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import assert from 'node:assert/strict';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve('dist'),out=fs.mkdtempSync(path.join(os.tmpdir(),'mg-club-full-'));
const U='11111111-1111-4111-8111-111111111111',C='22222222-2222-4222-8222-222222222222',A='44444444-4444-4444-8444-444444444444';
const user={id:U,Name:'Тестовый участник',email:'fixture@example.invalid',role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{provider:'email'}};
const token=[{alg:'HS256',typ:'JWT'},{sub:U,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'synthetic'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:token,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const bundle={club:{id:C,owner:{id:A,Name:'Автор клуба',Photo:null},title:'Тестовый клуб',short_descr:'Локальный стенд',descr:'Локальный стенд',label:null,price:3500,sub_id:'123',subs:[]},club_posts:[],later_posts:[],user_sub:{id:'33333333-3333-4333-8333-333333333333',suber:U,club:C,active:true,end_date:'2099-12-31'},subers:[]};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');let p=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return}if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!fs.existsSync(p)){res.writeHead(404).end();return}res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream');res.end(fs.readFileSync(p))});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='https://app.meetgu.ru';
const results=[];const attachmentsEnabled=process.env.ATTACHMENTS!=='0';
try{for(const engine of (process.env.ENGINES||'Chrome,WebKit').split(',')){
 const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch({headless:true});
 try{for(const width of (process.env.WIDTHS||'390,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block',timezoneId:'Europe/Moscow'});
 const requests=[],writes=[],errors=[],uploads=[],resourceErrors=[],componentChunks=[];let messages=Array.from({length:16},(_,i)=>({id:`55555555-5555-4555-8555-${String(i).padStart(12,'0')}`,club:C,text:`Сообщение ${i+1}: https://example.org/${i}`,img:i===15?['https://fixture.invalid/photo.png']:[],owner:{id:i%2?U:A,Name:i%2?'Тестовый участник':'Автор клуба',Photo:null},created_at:`2026-11-24T12:${String(i).padStart(2,'0')}:00Z`,deleted:false}));
 await context.routeWebSocket('**/*',ws=>ws.close());
 await context.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());const api=/\/(rest|auth|functions|storage)\/v1\//.test(u.pathname);
 if(u.origin===origin&&!api&&!u.pathname.startsWith('/_')&&!u.pathname.startsWith('/api')&&q.method()==='GET')return r.continue();
 requests.push(q.method()+' '+u.pathname);let data=[];const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','content-type':'application/json'};
 if(q.method()==='OPTIONS')return r.fulfill({status:200,headers,body:''});
 if(u.hostname==='fixture.invalid')return r.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.resolve('public/images/apple-touch-180.png'))});
 if(u.pathname.includes('/auth/v1/user'))data=user;else if(u.pathname.includes('/auth/v1/token'))data=session;
 else if(u.pathname.endsWith('/club_chat_capabilities'))data={attachments:attachmentsEnabled&&q.postDataJSON()?.p_club===C};
 else if(u.pathname.includes('/storage/v1/object/sign/')&&q.method()==='GET')return r.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.resolve('public/images/apple-touch-180.png'))});
 else if(u.pathname.includes('/storage/v1/object/sign/'))data={signedURL:'/object/sign/club-chat-private/fixture.png'};
 else if(u.pathname.includes('/storage/v1/object/club-chat-private/')){uploads.push(u.pathname);data={Key:u.pathname};}
 else if(u.pathname.endsWith('/club_chat_send_attachment')){const b=q.postDataJSON();assert.equal(b.p_club,C);assert(!('p_user' in b));const id=crypto.randomUUID();messages.push({id,club:C,text:null,img:[],owner:{id:U,Name:user.Name},created_at:'2026-11-24T13:01:00Z',attachment_path:b.p_path,attachment_type:b.p_kind,attachment_name:b.p_name,attachment_size:b.p_size});data=id;}
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
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(/ClubChatAttachments.*\.js/.test(r.url()))componentChunks.push(new URL(r.url()).pathname);if(r.status()>=400&&/\.(js|css)(\?|$)/.test(r.url()))resourceErrors.push(new URL(r.url()).pathname)});await page.goto(origin+'/club/?club='+C);
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
 if(attachmentsEnabled){const addon=page.locator('.club-attachments').filter({has:page.locator('button:visible')});const attach=addon.getByRole('button',{name:'Прикрепить файл',exact:true});await attach.waitFor();
 assert.equal(await attach.innerText(),'');assert.equal(await attach.locator('svg').count(),1);
 const iconBox=await attach.boundingBox(),inputBox=await input.boundingBox();console.log('BOXES',JSON.stringify({iconBox,inputBox}));await page.screenshot({path:path.join(out,engine+'-'+width+'-composer.png'),fullPage:true});console.log('SCREENSHOT_DIR',out);assert(iconBox.x<inputBox.x);assert(Math.abs(iconBox.y-inputBox.y)<6,'icons beside textarea');
 const chooserPromise=page.waitForEvent('filechooser');await attach.click();await chooserPromise;

 for(const [name,mimeType] of [['lesson.pdf','application/pdf'],['photo.png','image/png']]){
 await addon.locator('input[type=file]').setInputFiles({name,mimeType,buffer:Buffer.from('synthetic')});
 await page.screenshot({path:path.join(out,engine+'-'+width+'-'+name+'-pending.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await addon.getByRole('button',{name:'Отправить вложение',exact:true}).click();
 const msg=page.locator('.mg-club-msg:visible').last();await msg.getByText('Открыть вложение',{exact:true}).waitFor();await msg.getByText('Открыть вложение',{exact:true}).click();
 if(mimeType==='image/png')await msg.locator('.club-file img').waitFor();else await msg.getByRole('link',{name:/lesson.pdf/}).waitFor();
 }
 assert.equal(uploads.length,2);}else{assert.equal(await page.locator('.club-attachments').filter({has:page.locator('button:visible')}).count(),0);assert.equal(uploads.length,0);}assert.equal(await page.locator('.mg-club-msg:visible').first().locator('.mg-club-msg__sender').getAttribute('href'),'/profile_page?user='+A);
 await page.getByRole('button',{name:'Открыть фото 1'}).filter({visible:true}).last().click();await page.waitForTimeout(200);
 assert(await page.locator('img[src="https://fixture.invalid/photo.png"]:visible').count()>=2,'real gallery popup should display photo');
 await page.screenshot({path:path.join(out,engine+'-'+width+'-photo.png'),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);assert.deepEqual(resourceErrors,[]);assert(componentChunks.length>0,'published attachment component loaded');results.push({componentChunks,resourceErrors,engine,width,history:true,sent:true,deleted:true,photoOpened:true,attachmentsEnabled,privateFileSent:attachmentsEnabled,privateImageSent:attachmentsEnabled,profileLink:true,errors});await context.close();
 }}finally{await browser.close()}
}}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
console.log(JSON.stringify({results,out}));
