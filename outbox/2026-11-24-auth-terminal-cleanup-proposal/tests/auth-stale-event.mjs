import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,''),require=createRequire(import.meta.url);const {GoTrueClient}=require('@supabase/auth-js');
const s={access_token:'synthetic-B',refresh_token:'synthetic-B',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'B'}};
const map=new Map([['session',JSON.stringify(s)]]);const client=new GoTrueClient({url:'https://fixture.invalid/auth/v1',storageKey:'session',autoRefreshToken:false,detectSessionInUrl:false,storage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},fetch:()=>{throw new Error('No network permitted')}});await client.initialize();
const changes=[];const noop=()=>{};const ctx={client:{auth:client},onChange:id=>changes.push(id),sbWithRetry:(_label,fn)=>fn(),setTimeout,clearTimeout,Date,Number,window:{addEventListener:noop,removeEventListener:noop},document:{addEventListener:noop,removeEventListener:noop},navigator:{onLine:true}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(root+'/src/_front/chrome/confirmedSession.js','utf8').replace(/^import .*;\n/gm,'').replace('export function','function')+'\nglobalThis.obs=observeConfirmedSession(client,onChange);',ctx);
await ctx.obs.refresh();await new Promise(r=>setTimeout(r,0));assert.equal(ctx.obs.snapshot().uid,'B');
// Simulate delivery through the exact subscriber path used by SDK BroadcastChannel.
await client._notifyAllSubscribers('SIGNED_OUT',null,false);
assert.equal(JSON.parse(map.get('session')).user.id,'B');assert.equal(ctx.obs.snapshot().uid,null);
await new Promise(r=>setTimeout(r,30));assert.equal(ctx.obs.snapshot().uid,'B');
map.delete('session');await client._notifyAllSubscribers('SIGNED_OUT',null,false);assert.equal(ctx.obs.snapshot().uid,null);await new Promise(r=>setTimeout(r,30));assert.equal(ctx.obs.snapshot().uid,null);
ctx.obs.stop();await client.stopAutoRefresh();
console.log(JSON.stringify({eventDelivery:'injected into actual SDK subscriber path',storageUser:'B',recoveredUser:'B',realLogoutClearsView:true,changes}));
