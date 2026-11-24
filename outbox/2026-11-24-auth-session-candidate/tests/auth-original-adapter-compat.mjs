import assert from 'node:assert/strict';
import {GoTrueClient} from '@supabase/auth-js';
import {authRecoveryOptions} from './fixtures/authRecovery-pre-upgrade.js';
globalThis.window={location:{origin:'https://fixture.invalid'}};
const s=id=>({access_token:'synthetic-'+id,refresh_token:'rt-'+id,user:{id},expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'});
const res=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});
const results=[];
for(const status of [400,401]) {
 const m=new Map([['session',JSON.stringify(s('A'))]]);const storage={getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
 const create=()=>{const o=authRecoveryOptions('https://fixture.invalid','session',{storage,fetcher:async url=>new URL(url).pathname.endsWith('/logout')?res({}):new URL(url).searchParams.get('grant_type')==='password'?res(s('B')):res({code:'refresh_token_not_found',message:'synthetic'},status)});return new GoTrueClient({url:'https://fixture.invalid/auth/v1',...o.auth,autoRefreshToken:false,detectSessionInUrl:false,fetch:o.global.fetch})};
 const a=create(),b=create();await a.initialize();await b.initialize();
 const refresh=await a._callRefreshToken('rt-A');assert(refresh.error);assert.equal(JSON.parse(m.get('session')).user.id,'A');
 const login=await b.signInWithPassword({email:'synthetic@example.test',password:'synthetic-only'});assert.equal(login.data.user.id,'B');
 let error=null;try{const result=await a.signOut();error=result.error?.name||null}catch(e){error=e.name}
 const finalUser=JSON.parse(m.get('session')||'null')?.user.id??null;results.push({status,finalUser,logoutError:error});a.dispose();b.dispose();
}
console.log(JSON.stringify({sdk:'2.119.2',adapter:'unchanged previous candidate',results}));assert(results.every(r=>r.finalUser===null),'explicit logout must remove B');
