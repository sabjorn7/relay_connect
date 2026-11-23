import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';import test from 'node:test';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {parse}=require('./vendor/babel-parser.cjs');
const patcher=new Function('parse','source',fs.readFileSync(new URL('./patcher.cjs',import.meta.url),'utf8'));
const call='await EdgeRuntime.userWorkers.create({ servicePath, memoryLimitMb, workerTimeoutMs, noModuleCache, importMapPath, envVars })';
function patch(source){const r=patcher(parse,source);assert.equal(r.error,undefined);const raw=Buffer.from(source);assert.equal(raw.subarray(r.start_byte,r.end_byte).toString(),'envVars');return {r,text:Buffer.concat([raw.subarray(0,r.start_byte),Buffer.from(r.replacement),raw.subarray(r.end_byte)]).toString()};}
test('only envVars property bytes change; five other parameters retained',()=>{const source='// envVars unrelated\nconst x="envVars";'+call+';';const {r,text}=patch(source);assert.equal(text.replace(r.replacement,'envVars'),source);assert.ok(text.includes('memoryLimitMb, workerTimeoutMs, noModuleCache, importMapPath'));});
test('UTF-8 byte offsets preserve Cyrillic prefix and comments',()=>{const source='// Привет 😃\n'+call+'; // конец';const {r,text}=patch(source);assert.equal(text.replace(r.replacement,'envVars'),source);});
test('commented-out call never becomes a patch target',()=>{assert.equal(patcher(parse,'// '+call).error,'unexpected_create_call_count');});
test('multiple calls rejected',()=>{assert.equal(patcher(parse,call+';'+call).error,'unexpected_create_call_count');});
test('extra property rejected',()=>{assert.equal(patcher(parse,call.replace('envVars }','envVars, extra }')).error,'unexpected_create_parameters');});
test('non-shorthand envVars rejected',()=>{assert.equal(patcher(parse,call.replace('envVars }','envVars: other }')).error,'unexpected_create_parameters');});
test('different argument shape rejected',()=>{assert.equal(patcher(parse,'await EdgeRuntime.userWorkers.create(opts)').error,'unexpected_create_argument');});
test('invalid source rejected',()=>{assert.equal(patcher(parse,'const = ').error,'source_parse_failed');});
test('actual dynamic import: checkout receives key; other function unchanged',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mg-key-forward-test-'));
 fs.copyFileSync(new URL('./club-key-env.mjs',import.meta.url),path.join(dir,'club-key-env.mjs'));
 const fixture=`export async function dispatch(req) {if(req.reject)return {status:401};const functionName=req.name;const servicePath='/home/deno/functions/'+functionName;const memoryLimitMb=150,workerTimeoutMs=60000,noModuleCache=false,importMapPath=null;const envVars=Object.entries(Deno.env.toObject());const worker=${call};return worker.fetch(req);}`;
 fs.writeFileSync(path.join(dir,'main.mjs'),patch(fixture).text);
 const observed=[];let reads=0;const env={SHARED:'synthetic-common'};
 const priorDeno=globalThis.Deno,priorEdge=globalThis.EdgeRuntime;
 globalThis.Deno={env:{toObject:()=>env},readTextFile:async p=>{reads++;assert.equal(p,'/home/deno/functions/checkout-pay-link/.prodamus-key.json');return '{"key":"synthetic-original-key"}';}};
 globalThis.EdgeRuntime={userWorkers:{create:async opts=>{observed.push(opts);return {fetch:async req=>({status:200,name:req.name})};}}};
 try{
  const {dispatch}=await import(pathToFileURL(path.join(dir,'main.mjs')));
  assert.deepEqual(await dispatch({reject:true,name:'checkout-pay-link'}),{status:401});assert.equal(observed.length,0);
  await dispatch({name:'checkout-pay-link'});await dispatch({name:'another-function'});
  assert.deepEqual(observed[0].envVars,[['SHARED','synthetic-common'],['PRODAMUS_SECRET_KEY','synthetic-original-key']]);
  assert.deepEqual(observed[1].envVars,[['SHARED','synthetic-common']]);assert.deepEqual(env,{SHARED:'synthetic-common'});assert.equal(reads,1);
  for(const x of observed)assert.deepEqual([x.memoryLimitMb,x.workerTimeoutMs,x.noModuleCache,x.importMapPath],[150,60000,false,null]);
 }finally{globalThis.Deno=priorDeno;globalThis.EdgeRuntime=priorEdge;}
});
