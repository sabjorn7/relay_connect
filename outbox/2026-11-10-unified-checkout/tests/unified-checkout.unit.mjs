import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addProduct, checkoutIntent, payCart } from '../src/_front/checkout/cartApi.js';
import { createCheckoutHandler } from '../supabase/functions/checkout-pay-link/handler.mjs';
const U='10000000-0000-4000-8000-000000000001',O='20000000-0000-4000-8000-000000000001',P='30000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SITE_ORIGIN:'https://local.invalid'};
function fixture({ claim, zeroResult, providerError, badLink, rpcError }={}) {
 const calls=[];
 const fetch=async(url,init={})=>{
  const u=new URL(url);const body=init.body?JSON.parse(init.body):null;calls.push({url:u,init,body});
  if(u.hostname==='meetguru.payform.ru'){
   assert.equal(init.headers,undefined,'provider must not receive Supabase credentials');
   if(providerError)throw Error('synthetic-service internal failure');
   return new Response(badLink||'https://meetguru.payform.ru/local-payment');
  }
  assert.equal(u.hostname,'synthetic.invalid');
  if(u.pathname==='/auth/v1/user')return Response.json({id:U});
  const name=u.pathname.split('/').at(-1);
  if(rpcError&&name==='checkout_prepare')return Response.json({message:rpcError},{status:400});
  if(name==='checkout_prepare'){
   assert.equal(init.headers.Authorization,'Bearer synthetic-user');
   assert.deepEqual(Object.keys(body).sort(),['p_code','p_request_id','p_shop_ids']);
   return Response.json({order_id:O,total:6000});
  }
  assert.equal(init.headers.Authorization,'Bearer synthetic-service');
  assert.equal(body.p_actor_id,U,'buyer must come from the verified auth endpoint');
  if(name==='checkout_acquire_link')return Response.json(claim||{order_id:O,total:6000,lines:[{name:'Course',price:1000},{name:'Event',price:2000},{name:'Stream',price:3000}]});
  if(name==='checkout_complete_zero')return Response.json(zeroResult||{status:'fulfilled'});
  if(name==='checkout_store_link')return new Response(null,{status:204});
  throw Error('unexpected RPC '+name);
 };
 const handler=createCheckoutHandler({fetch,env,uuid:()=>P});
 const request=(extra={})=>handler(new Request('https://local.invalid/checkout',{method:'POST',headers:{Authorization:'Bearer synthetic-user'},body:JSON.stringify({request_id:P,shop_ids:[P],promo_code:null,owner:'spoof',price:1,products:[{price:1}],success_url:'https://evil.invalid',...extra})}));
 return {calls,handler,request};
}
test('add course/event/stream sends one shared RPC with no caller price or buyer',async()=>{
 for(const type of ['course','event','stream']){
  const calls=[];const sb={rpc:async(...a)=>{calls.push(a);return{data:{id:P}};}};
  await addProduct(sb,{type,id:P,agreed:type==='event',price:1,buyer:'spoof'});
  assert.equal(calls[0][0],'cart_add_product');assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_agreed','p_payment_type','p_product_id','p_renewal','p_type']);
 }
});
test('invalid product references and non-event deposit fail before any request',async()=>{
 const sb={rpc:()=>{throw Error('must not call');}};
 await assert.rejects(addProduct(sb,{type:'unknown',id:P}));await assert.rejects(addProduct(sb,{type:'course',id:'x'}));await assert.rejects(addProduct(sb,{type:'stream',id:P,paymentType:'deposit'}));
});
test('intent persists across retries; cart order and promo case do not create duplicate intents',()=>{
 const values=new Map();const store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let n=0;
 assert.equal(checkoutIntent(store,U,[P,O],' code ',()=>{n++;return P;}),P);
 assert.equal(checkoutIntent(store,U,[O,P],'CODE',()=>{n++;return O;}),P);assert.equal(n,1);
});
test('browser checkout never sends amounts or an owner and does not call the provider directly',async()=>{
 let payload;const sb={functions:{invoke:async(name,{body})=>{assert.equal(name,'checkout-pay-link');payload=body;return{data:{payLink:'https://meetguru.payform.ru/local',order_id:O}};}}};
 await payCart(sb,{userId:U,ids:[P],storage:null});assert.deepEqual(Object.keys(payload).sort(),['promo_code','request_id','shop_ids']);
});
test('browser rejects hostile payment URLs and recognizes completed zero checkout',async()=>{
 for(const url of ['javascript:alert(1)','https://evil.invalid','https://x:secret@meetguru.payform.ru/local'])await assert.rejects(payCart({functions:{invoke:async()=>({data:{payLink:url}})}},{userId:U,ids:[P],storage:null}));
 assert.deepEqual(await payCart({functions:{invoke:async()=>({data:{completed:true,order_id:O}})}},{userId:U,ids:[P],storage:null}),{completed:true,orderId:O});
});
test('one merchant link includes all server-priced mixed lines; spoofed fields ignored',async()=>{
 const f=fixture();const r=await f.request();assert.equal(r.status,200);assert.equal((await r.json()).payLink,'https://meetguru.payform.ru/local-payment');
 const provider=f.calls.find(x=>x.url.hostname==='meetguru.payform.ru');assert.equal(provider.url.searchParams.get('products[2][price]'),'3000');assert.equal(provider.url.searchParams.get('products[0][price]'),'1000');assert.equal(provider.url.searchParams.get('order_id'),O);assert.equal(provider.url.searchParams.get('urlSuccess'),'https://local.invalid/');
 assert.equal(f.calls.filter(x=>x.url.pathname.endsWith('checkout_store_link')).length,1);
});
test('existing payment link is returned without creating another provider link',async()=>{
 const f=fixture({claim:{payLink:'https://meetguru.payform.ru/existing',order_id:O}});assert.equal((await f.request()).status,200);assert(!f.calls.some(x=>x.url.hostname==='meetguru.payform.ru'));
});
test('zero-price checkout uses server settlement without Prodamus or fake payment proof',async()=>{
 const f=fixture({claim:{zero:true,order_id:O}});assert.equal((await(await f.request()).json()).completed,true);assert(!f.calls.some(x=>x.url.hostname==='meetguru.payform.ru'));const zero=f.calls.find(x=>x.url.pathname.endsWith('checkout_complete_zero'));assert.deepEqual(zero.body,{p_order_id:O,p_actor_id:U});
});
test('provider timeout/bad response keeps the order; no secrets or raw exception returned',async()=>{
 const f=fixture({providerError:true});const r=await f.request();assert.equal(r.status,503);const body=await r.text();assert(!body.includes('synthetic-service'));assert(!f.calls.some(x=>x.url.pathname.endsWith('checkout_store_link')));
});
test('hostile provider link is never persisted',async()=>{
 const f=fixture({badLink:'https://evil.invalid'});assert.equal((await f.request()).status,503);assert(!f.calls.some(x=>x.url.pathname.endsWith('checkout_store_link')));
});
test('CORS, method and auth guards run without database/provider calls',async()=>{
 const f=fixture();assert.equal((await f.handler(new Request('https://local.invalid',{method:'OPTIONS',headers:{Origin:'https://local.invalid'}}))).status,204);assert.equal((await f.handler(new Request('https://local.invalid',{method:'GET'}))).status,405);assert.equal((await f.handler(new Request('https://local.invalid',{method:'POST',headers:{Origin:'https://evil.invalid'}}))).status,403);assert.equal((await f.handler(new Request('https://local.invalid',{method:'POST',body:'{}'}))).status,401);assert.equal(f.calls.length,0);
});
test('no booking/capacity/refund infrastructure is part of the migration',()=>{
 const sql=fs.readFileSync(new URL('../supabase/migrations/pending_unified_checkout.sql',import.meta.url),'utf8');
 assert(!/create\s+table[^;]*(?:reserv|refund)/i.test(sql));assert(!/30 minutes|capacity_below|event_sold_out|checkout_private\.seats|expires_at timestamptz/i.test(sql));
});
test('financial loop/date math/credit algorithm remains byte-identical to inspected BuyCourse RPC',()=>{
 const base=fs.readFileSync(new URL('./fixtures/checkout-legacy-fulfillment.sql',import.meta.url),'utf8');const sql=fs.readFileSync(new URL('../supabase/migrations/pending_unified_checkout.sql',import.meta.url),'utf8');
 const part=s=>s.slice(s.indexOf('    -- Lock all credited authors'),s.indexOf('    update public."order" set paid=true,payment_id=p_payment_id where id=p_order_id;')).replace('    perform checkout_private.finish_products(p_order_id);\n','');assert.equal(part(sql),part(base));
});
