import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { videoProfile, roomVideoOptions, enableProfileCamera, captureWarning, availableResolutions } from '../src/_front/streams/videoQuality.js';
import { summarizeVideoStats } from '../src/_front/streams/videoStats.js';
import { connectPeerTubeQuality } from '../src/_front/streams/peerTubeQuality.js';

test('legacy defaults to HD, unknown saved/requested profiles fail closed', () => {
    assert.equal(videoProfile(null).id,'hd'); assert.equal(videoProfile(undefined).height,720);
    for(const bad of ['4k','1080p','__proto__','',0]) assert.throws(()=>videoProfile(bad));
});
test('capture, primary encoding and Egress profile agree; VP8 and adaptation retained', () => {
    for(const id of ['hd','full_hd']) {
        const p=videoProfile(id),r=roomVideoOptions(id);
        assert.equal(r.videoCaptureDefaults.resolution.height,p.height);
        assert.equal(r.publishDefaults.videoEncoding.maxFramerate,30);
        assert.equal(r.publishDefaults.videoEncoding.maxBitrate,p.cameraBitrate);
        assert.equal(r.publishDefaults.videoCodec,'vp8');assert(r.adaptiveStream&&r.dynacast&&r.publishDefaults.simulcast);
        const layers=r.publishDefaults.videoSimulcastLayers;
        assert(layers[0].height<layers[1].height&&layers[1].height<p.height);
    }
    assert.equal(videoProfile('full_hd').egressPreset,'H264_1080P_30');
    assert.equal(videoProfile('full_hd').egressBitrate,4500000);
});
test('unsupported camera resolution falls back without re-requesting denied permissions', async () => {
    const calls=[];const participant={async setCameraEnabled(enabled,options){calls.push(options);if(calls.length===1)throw Object.assign(new Error(),{name:'OverconstrainedError'});return 'working';}};
    assert.equal(await enableProfileCamera(participant,'full_hd'),'working');assert.equal(calls[1].resolution.height,360);
    await assert.rejects(enableProfileCamera({setCameraEnabled:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});}},'full_hd'),{name:'NotAllowedError'});
    assert.match(captureWarning({width:1280,height:720},'full_hd'),/ниже/);
    assert.equal(captureWarning({width:1920,height:1080},'full_hd'),'');
});
test('actual available resolutions only, including conditional Auto; no fictional 1080p', () => {
    assert.deepEqual(availableResolutions([{id:-1},{id:3,height:'720',active:true},{id:4,height:360},{id:3,height:720}]),[{id:-1,label:'Авто',active:false},{id:3,label:'720p',active:true}]);
    assert.deepEqual(availableResolutions(null),[]);
});
const report=(time,bytes,packets=100,lost=2)=>new Map([
    ['video',{id:'video',type:'outbound-rtp',kind:'video',timestamp:time,bytesSent:bytes,packetsSent:packets,frameWidth:1920,frameHeight:1080,framesPerSecond:29,remoteId:'remote',qualityLimitationReason:'bandwidth',address:'PRIVATE-IP',token:'PRIVATE-TOKEN'}],
    ['remote',{type:'remote-inbound-rtp',kind:'video',packetsLost:lost,roundTripTime:.08,jitter:.004}],
]);
test('bitrate needs two monotonic samples; RTT, losses and unavailable metrics stay distinct', () => {
    const a=summarizeVideoStats(report(1000,1000));assert.equal(a.layers[0].bitrate,null);assert.equal(a.layers[0].lossPercent,null);
    const b=summarizeVideoStats(report(3000,1001000,200,4),a.previous);assert.equal(b.layers[0].bitrate,4000000);assert.equal(b.layers[0].lossPercent,2);assert.equal(b.rttMs,80);assert.equal(b.layers[0].jitterMs,4);
    assert.equal(summarizeVideoStats(report(100,10),b.previous).layers[0].bitrate,null);
    assert(!JSON.stringify(b.layers).includes('PRIVATE'));assert.equal(summarizeVideoStats(null).layers.length,0);
});
function fakeEmbed({reply=true,rows=[{id:-1},{id:1080,height:1080}]}={}) {
    const listeners=new Set(),calls=[]; const host={addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
    let origin='https://player.invalid';
    const target={postMessage(raw,destination){const m=JSON.parse(raw);calls.push(m);assert.equal(destination,origin);
        if(reply&&m.id)queueMicrotask(()=>{for(const fn of listeners)fn({origin,source:target,data:JSON.stringify({id:m.id,result:m.method.endsWith('isReady')?true:m.method.endsWith('getResolutions')?rows:null})});});}};
    return {host,calls,listeners,target,iframe:{src:origin+'/videos/embed/synthetic?api=1',contentWindow:target}};
}
test('Embed protocol handshake, available qualities and switching work without media requests', async () => {
    const e=fakeEmbed();const client=connectPeerTubeQuality(e.iframe,{window:e.host,timeout:50});
    await client.ready;assert.equal((await client.getResolutions()).length,2);await client.setResolution(-1);
    assert(e.calls.some(m=>m.method==='peertube::setResolution'&&m.params===-1));client.dispose();assert.equal(e.listeners.size,0);
});
test('wrong origin/source responses cannot satisfy requests; unsupported API times out', async () => {
    const e=fakeEmbed({reply:false});const client=connectPeerTubeQuality(e.iframe,{window:e.host,timeout:10});
    for(const fn of e.listeners)fn({origin:'https://evil.invalid',source:e.target,data:JSON.stringify({id:1,result:true})});
    for(const fn of e.listeners)fn({origin:'https://player.invalid',source:{},data:JSON.stringify({id:1,result:true})});
    await assert.rejects(client.ready,/unavailable/);client.dispose();assert.equal(e.listeners.size,0);
});
test('disposing a loading iframe cancels timers and pending readiness', async () => {
    const e=fakeEmbed({reply:false});const client=connectPeerTubeQuality(e.iframe,{window:e.host,timeout:20});
    const result=assert.rejects(client.ready,/closed|unavailable/);client.dispose();await result;assert.equal(e.listeners.size,0);
});
test('backend profile contract is exactly the same module; admission precedes resource allocation', () => {
    const root=new URL('../reviews/2026-11-09-stream-quality/orchestrator/src/',import.meta.url);
    assert.equal(fs.readFileSync(new URL('videoQuality.mjs',root),'utf8'),fs.readFileSync(new URL('../src/_front/streams/videoQuality.js',import.meta.url),'utf8'));
    const s=fs.readFileSync(new URL('server.mjs',root),'utf8');
    assert(s.indexOf('const reservation = await reserveVideoStart')<s.indexOf('live = await createLive'));
    assert.match(s,/stream\.livekit_egress_id \? \(await getVideoRun\(stream\)\)\?\.profile \|\| 'hd'/);
});
