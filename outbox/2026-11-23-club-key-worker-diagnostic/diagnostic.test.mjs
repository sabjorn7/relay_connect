import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const src=fs.readFileSync(new URL('./index.ts',import.meta.url),'utf8')
 .replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify('file:///fixture/checkout-pay-link/index.ts'));
const execute=new Function('Deno','console','createCheckoutHandler','fetch',src);
const secret='SYNTHETIC-PRIVATE-KEY-NOT-FOR-OUTPUT';
function run({env,file,readError,envError}={}) {
 const records=[];let selected,served=0,reads=0,failure;
 const Deno={env:{get(name){if(name==='PRODAMUS_SECRET_KEY'){if(envError)throw envError;return env;}return undefined;}},readTextFileSync(url){reads++;assert.equal(url.pathname,'/fixture/checkout-pay-link/.prodamus-key.json');if(readError)throw readError;return file;},serve(){served++;}};
 try {execute(Deno,{info(line){records.push(JSON.parse(line));}},({env})=>{selected=env.PRODAMUS_SECRET_KEY;return ()=>{};},()=>{throw Error('network forbidden');});}catch(e){failure=e;}
 assert.equal(records.length,1);assert.equal(reads,1);
 const report=records[0];
 assert.deepEqual(Object.keys(report).sort(),['event','env_present','env_nonempty','env_error','file_read','file_error','json_valid','json_error','json_object','key_present','key_nonempty','source'].sort());
 const text=JSON.stringify(records);
 for(const prohibited of [secret,'@','file://','fixture/','stack','message','hash','length'])assert.ok(!text.includes(prohibited));
 return {report,selected,served,failure};
}
function error(name){const e=new Error(secret+' https://private.invalid?token='+secret);e.name=name;return e;}
test('valid file: exact key preserved, no value/length/hash exposed',()=>{const x=run({file:JSON.stringify({key:secret})});assert.equal(x.selected,secret);assert.equal(x.report.key_nonempty,true);assert.equal(x.report.source,'file');assert.equal(x.served,1);});
test('environment takes precedence; independent file check still recorded',()=>{const x=run({env:secret,file:JSON.stringify({key:'different-synthetic'})});assert.equal(x.selected,secret);assert.equal(x.report.env_nonempty,true);assert.equal(x.report.source,'env');});
for(const name of ['NotFound','PermissionDenied','NotSupported','TypeError'])test('file error '+name+' only exposes allowlisted type',()=>{const x=run({readError:error(name)});assert.equal(x.report.file_error,name);assert.equal(x.report.file_read,false);assert.equal(x.selected,undefined);assert.equal(x.served,1);});
test('arbitrary error name/message/stack cannot enter log',()=>{const x=run({readError:error(secret)});assert.equal(x.report.file_error,'Other');});
test('malformed JSON is distinguished from read failure',()=>{const x=run({file:'{'+secret});assert.equal(x.report.file_read,true);assert.equal(x.report.json_valid,false);assert.equal(x.report.json_error,'SyntaxError');});
for(const [label,value] of [['missing',{}],['empty',{key:''}],['null',null],['array',[]],['non-string',{key:123}],['whitespace',{key:'  '}]])test('invalid key format: '+label,()=>{const x=run({file:JSON.stringify(value)});assert.equal(x.report.json_valid,true);assert.equal(x.report.key_nonempty,false);});
test('empty environment falls back without changing file key',()=>{const x=run({env:'',file:JSON.stringify({key:secret})});assert.equal(x.report.env_present,true);assert.equal(x.report.env_nonempty,false);assert.equal(x.selected,secret);});
test('environment access error logs no raw exception and does not silently proceed',()=>{const x=run({envError:error('PermissionDenied'),file:JSON.stringify({key:secret})});assert.equal(x.report.env_error,'PermissionDenied');assert.equal(x.served,0);assert.equal(x.failure.message,'club_key_environment_unavailable');});
test('valid environment survives unavailable optional file',()=>{const x=run({env:secret,readError:error('NotFound')});assert.equal(x.selected,secret);assert.equal(x.served,1);});
