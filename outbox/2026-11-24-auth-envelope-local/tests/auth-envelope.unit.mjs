import assert from 'node:assert/strict';
import {authRecoveryOptions} from '../src/_front/chrome/authRecovery.js';
globalThis.window={location:{origin:'https://fixture.invalid'}};
const data=new Map();
const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
const key='test:auth-v2';
const a=authRecoveryOptions('https://fixture.invalid',key,{storage,fetcher:()=>{throw Error('No network')}}).auth.storage;
const s=JSON.stringify({access_token:'synthetic',refresh_token:'synthetic',user:{id:'B',name:'Кирилл 👋'}});
a.setItem(key,s);assert.equal(a.getItem(key),s);
assert(data.get(key).startsWith('mg-auth-v2:'));
assert(!data.get(key).includes('access_token')&&!data.get(key).includes('refresh_token'));
a.setItem(key+'-code-verifier','synthetic-pkce');assert.equal(data.get(key+'-code-verifier'),'synthetic-pkce');
a.setItem(key+'-user','synthetic-user');assert.equal(data.get(key+'-user'),'synthetic-user');
data.set('legacy',s);a.removeItem(key);assert.equal(a.getItem(key),null);assert.equal(data.get('legacy'),s);
data.set(key,s);assert.equal(a.getItem(key),null,'plain legacy-shaped records must not migrate');
for(const bad of ['mg-auth-v1:abc','mg-auth-v2:!!!','mg-auth-v2:/w==']){data.set(key,bad);assert.equal(a.getItem(key),null)}
console.log(JSON.stringify({status:'PASS',checks:['unicode roundtrip','legacy scanner rejection','PKCE unchanged','user key unchanged','scoped removal','no plaintext migration','malformed/version rejection']}));
