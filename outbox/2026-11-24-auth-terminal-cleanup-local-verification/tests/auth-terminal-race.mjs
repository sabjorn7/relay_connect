import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { authRecoveryOptions } from '../src/_front/chrome/authRecovery.js';
const require=createRequire(import.meta.url);
const {GoTrueClient}=require('@supabase/supabase-js');
globalThis.window={location:{origin:'https://fixture.invalid'}};
const session=(id,expired=false)=>({access_token:'synthetic-access-'+id,refresh_token:'synthetic-refresh-'+id,user:{id},expires_at:Math.floor(Date.now()/1000)+(expired?-10:3600),expires_in:3600,token_type:'bearer'});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});
const results=[];
for(const status of [400,401]) {
 const data=new Map([['session',JSON.stringify(session('A'))]]);
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const options=()=>authRecoveryOptions('https://fixture.invalid','session',{storage,fetcher:async url=>new URL(url).pathname.endsWith('/logout')?response({}):new URL(url).searchParams.get('grant_type')==='password'?response(session('B')):response({code:'refresh_token_not_found',message:'synthetic invalid token'},status)});
 const make=()=>{const o=options();return new GoTrueClient({url:'https://fixture.invalid/auth/v1',...o.auth,autoRefreshToken:false,detectSessionInUrl:false,fetch:o.global.fetch})};
 // Two independent clients here simulate two tabs only; product code still has one per tab.
 const a=make(),b=make();await a.initialize();await b.initialize();
 data.set('session',JSON.stringify(session('A',true)));a.autoRefreshToken=true;
 let signedOut=0,loginSucceeded=false,observedB=false;
 const {data:{subscription}}=a.onAuthStateChange(async event=>{
  if(event==='SIGNED_OUT'&&++signedOut===1){
   const result=await b.signInWithPassword({email:'synthetic@example.test',password:'synthetic-only'});
   loginSucceeded=!result.error&&result.data.user.id==='B';
   observedB=JSON.parse(data.get('session')||'null')?.user.id==='B';
  }
 });
 // Actual foreground/startup SDK recovery path, including its second terminal cleanup.
 const originalError=console.error;console.error=()=>{};
 try {await a._recoverAndRefresh();} finally {console.error=originalError;subscription.unsubscribe();await a.stopAutoRefresh();await b.stopAutoRefresh();}
 const finalUser=JSON.parse(data.get('session')||'null')?.user.id||null;
 assert(loginSucceeded&&observedB);assert.equal(signedOut,1);assert.equal(finalUser,'B');
 const logout=await b.signOut();assert.equal(logout.error,null);assert.equal(data.has('session'),false);
 results.push({status,loginBConfirmed:true,storageContainedB:true,terminalCleanupEvents:signedOut,finalUser,releaseBlocker:false,logoutPassed:true});
}
console.log(JSON.stringify({sdk:'2.119.2',scope:'Actual SDK + proposed adapter; isolated synthetic two-tab interleaving; no production calls',results}));
