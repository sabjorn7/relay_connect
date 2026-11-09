import test from 'node:test';
import assert from 'node:assert/strict';
import { streamFullHdAllowed } from '../src/_front/streams/streamQualityAccess.js';
test('permission request names only stream_id; owner comes from server auth',async()=>{
 const calls=[];assert.equal(await streamFullHdAllowed({rpc:async(...args)=>{calls.push(args);return {data:{version:2,full_hd_allowed:true}};}},'synthetic-stream'),true);
 assert.deepEqual(calls,[['stream_video_quality_for_stream',{p_stream_id:'synthetic-stream'}]]);
});
test('only an explicit scoped version-2 permission enables the UI, never the global flag',async()=>{
 for(const data of [null,{version:1,full_hd_allowed:true},{version:2,full_hd_allowed:false},{version:2,full_hd_enabled:true},{version:2,full_hd_allowed:'true'}])assert.equal(await streamFullHdAllowed({rpc:async()=>({data})},'s'),false);
});
test('RPC/transport errors fail closed without any fallback or write request',async()=>{
 assert.equal(await streamFullHdAllowed({rpc:async()=>({data:{version:2,full_hd_allowed:true},error:{code:'denied'}})},'s'),false);
 assert.equal(await streamFullHdAllowed({rpc:async()=>{throw Error('offline');}},'s'),false);
});
