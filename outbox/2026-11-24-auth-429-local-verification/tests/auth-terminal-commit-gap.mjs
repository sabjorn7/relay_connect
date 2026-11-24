const encode=s=>'mg-auth-v2:'+Buffer.from(JSON.stringify(s)).toString('base64');
const decode=s=>s?JSON.parse(Buffer.from(s.slice(11),'base64').toString()):null;
// Deterministic interleaving on the actual SDK, no network or product monkey-patch.
import assert from 'node:assert/strict';
import {GoTrueClient} from '@supabase/supabase-js';
import {authRecoveryOptions} from '../src/_front/chrome/authRecovery.js';
globalThis.window={location:{origin:'https://fixture.invalid'}};
const s=(id,ttl=3600)=>({access_token:'synthetic-'+id,refresh_token:'rt-'+id,user:{id},expires_at:Math.floor(Date.now()/1000)+ttl,expires_in:3600,token_type:'bearer'});
const results=[];
for(const status of [400,401]) {
 const m=new Map([['session',encode(s('A'))]]);let armed=false,switched=false,outs=0;
 const storage={getItem(k){const value=m.get(k)||null;
  if(k==='session'&&armed&&!switched){switched=true;queueMicrotask(()=>m.set('session',encode(s('B'))));}
  return value;
 },setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
 const o=authRecoveryOptions('https://fixture.invalid','session',{storage,fetcher:async()=>{
  // Arm only after the adapter's post-response identity check: SDK's terminal
  // error parser then reads current storage before deciding to remove it.
  const response=new Response(JSON.stringify({code:'refresh_token_not_found',message:'synthetic'}),{status,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});
  const json=response.json.bind(response);response.json=async()=>{const body=await json();armed=true;return body};return response;
 }});
 const c=new GoTrueClient({url:'https://fixture.invalid/auth/v1',...o.auth,autoRefreshToken:false,detectSessionInUrl:false,fetch:o.global.fetch});await c.initialize();
 let initial;const ready=new Promise(r=>initial=r);
 const sub=c.onAuthStateChange(e=>{if(e==='SIGNED_OUT')outs++;if(e==='INITIAL_SESSION')initial()});await ready;
 m.set('session',encode(s('A',-10)));
 await c._callRefreshToken('rt-A');
 const user=decode(m.get('session'))?.user.id??null;
 results.push({status,switched,finalUser:user,signedOut:outs});
 sub.data.subscription.unsubscribe();c.dispose();
}

console.log(JSON.stringify({sdk:'2.119.2',results}));assert(results.every(r=>r.finalUser==='B'),'old terminal cleanup must preserve B');
