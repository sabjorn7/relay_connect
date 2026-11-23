import fs from 'node:fs';import crypto from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';
import {createCheckoutHandler} from './verification-fixtures/handler.mjs';
const index=fs.readFileSync(new URL('../2026-11-23-club-key-worker-diagnostic/index.ts',import.meta.url),'utf8');
assert.equal(crypto.createHash('sha256').update(index).digest('hex'),'a1aa4e054a18418568959113d83edd6395a8e3c2480b73222056a93779c2dac5');
const execute=new Function('Deno','console','createCheckoutHandler','fetch',index.replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify('file:///fixture/checkout-pay-link/index.ts')));
for(const present of [false,true])test('diagnostic precedes serve and anonymous 401; env present='+present,async()=>{
 const records=[],sequence=[];let handler,fetchCalls=0;
 const values={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',...(present?{PRODAMUS_SECRET_KEY:'synthetic-private-key'}:{})};
 const Deno={env:{get:n=>values[n]},readTextFileSync(){const e=new Error('synthetic-sensitive-error-text');e.name='PermissionDenied';throw e;},serve:h=>{sequence.push('serve');handler=h;}};
 execute(Deno,{info:line=>{sequence.push('diagnostic');records.push(JSON.parse(line));}},createCheckoutHandler,async()=>{fetchCalls++;throw Error('No network allowed');});
 assert.deepEqual(sequence,['diagnostic','serve']);assert.equal(records.length,1);assert.equal(records[0].source,present?'env':'none');
 for(let i=0;i<2;i++){
  const response=await handler(new Request('https://synthetic.invalid/checkout-pay-link',{method:'POST',body:'{}'}));
  assert.equal(response.status,401);assert.equal(response.headers.get('x-meetguru-club-version'),'club-rpc-1');assert.deepEqual(await response.json(),{error:'unauthorized'});
 }
 assert.equal(records.length,1,'Log is startup-only, not emitted for each request');assert.equal(fetchCalls,0,'No Auth API, SQL RPC or Prodamus call');
 const log=JSON.stringify(records);assert.ok(!log.includes('synthetic-private-key'));assert.ok(!log.includes('synthetic-sensitive-error-text'));
});
