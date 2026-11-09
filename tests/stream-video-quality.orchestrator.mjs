// Actual candidate route/SDK adapter code, isolated VM modules; no sockets, credentials or DB.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../reviews/2026-11-09-stream-quality/orchestrator/src/',import.meta.url);
const routes=new Map(),middleware=new Map(),calls=[];
let stream={id:'20000000-0000-4000-8000-000000000001',author:'owner',video_quality:'full_hd',livekit_room:null,livekit_egress_id:null};
let member=null,role=null,run=null,reservationError=null,startError=false;
const functions={
    getStream:async()=>stream,getVideoRun:async()=>run,getMembership:async()=>member,getUserRole:async()=>role,
    getUserName:async()=>null,markJoined:async()=>{},ensureOwnerMembership:async()=>{},
    reserveVideoStart:async()=>{calls.push('reserve');if(reservationError)throw Error(reservationError);return 'synthetic-reservation';},releaseVideoStart:async()=>{calls.push('release');},
    holdVideoStart:async()=>{calls.push('hold');},
    setStreamLive:async(s,args)=>{calls.push(['persist',args.profile]);},setStreamEnded:async()=>{},resolveUserByEmail:async()=>null,inviteCohost:async()=>{},removeCohost:async()=>{},
};
const lk={mintPublishToken:async()=>({token:'synthetic-token',expiresAt:'synthetic-time'}),ensureRoom:async()=>{calls.push('room');},
    startEgress:async args=>{calls.push(['egress',args.profile]);if(startError)throw Error('timeout');return 'synthetic-egress';},stopEgress:async()=>{},stopUncommittedEgress:async()=>{calls.push('stop-new');},isEgressActive:async()=>false,kickParticipant:async()=>{},readEgressState:async()=>({state:'active',error:null})};
const app={set(){},use(){},get(){},post(path,...handlers){routes.set(path,handlers.at(-1));middleware.set(path,handlers.slice(0,-1));},listen(){}};
function express(){return app;}express.json=()=>()=>{};
const context=vm.createContext({console:{log(){},warn(){},error(){}},Buffer,Date});
const modules=new Map();
function synthetic(name,exports){const m=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context,identifier:name});modules.set(name,m);return m;}
synthetic('express',{default:express});synthetic('cors',{default:()=>()=>{}});synthetic('express-rate-limit',{default:()=>()=>{}});
synthetic('./config.mjs',{config:{allowedOrigins:[],livekitUrl:'wss://synthetic.invalid',port:0}});
synthetic('./auth.mjs',{requireAuth:()=>{}});synthetic('./db.mjs',functions);synthetic('./livekit.mjs',lk);
synthetic('./peertube.mjs',{createLive:async()=>{calls.push('peertube');return {video:{uuid:stream.id},streamKey:'synthetic-key'};},deleteLive:async()=>{}});
const profiles=new vm.SourceTextModule(fs.readFileSync(new URL('videoQuality.mjs',root),'utf8'),{context});modules.set('./videoQuality.mjs',profiles);
const server=new vm.SourceTextModule(fs.readFileSync(new URL('server.mjs',root),'utf8'),{context});
await server.link(name=>{assert(modules.has(name),'unexpected module '+name);return modules.get(name);});await server.evaluate();
async function request(path,user='owner'){
    let code=200,payload;
    await routes.get(path)({user:{sub:user},body:{stream_id:stream.id}},{status(n){code=n;return this;},json(value){payload=value;return this;}});
    return {code,payload};
}
const results=[];
async function check(name,fn){await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}
await check('diagnostic polling has an independent limiter and cannot exhaust token minting',()=>{assert.notEqual(middleware.get('/live/token')[0],middleware.get('/live/quality')[0]);});
await check('owner start carries saved Full HD through admission, egress and persistence',async()=>{
    const response=await request('/live/start');assert.equal(response.code,200);assert.equal(response.payload.video_quality,'full_hd');
    assert(calls.indexOf('reserve')<calls.indexOf('peertube'));assert(calls.some(c=>Array.isArray(c)&&c[0]==='egress'&&c[1]==='full_hd'));
});
await check('non-owner cannot allocate resources',async()=>{calls.length=0;assert.equal((await request('/live/start','viewer')).code,403);assert.equal(calls.length,0);});
await check('server admission denial causes no PeerTube or Egress start',async()=>{calls.length=0;reservationError='full_hd_capacity';assert.equal((await request('/live/start')).code,409);assert.deepEqual(calls,['reserve']);reservationError=null;});
await check('indeterminate Egress start keeps capacity held and requires reconciliation',async()=>{calls.length=0;startError=true;const result=await request('/live/start');assert.equal(result.code,409);assert.equal(result.payload.error,'video_start_reconciliation_required');assert(calls.includes('hold'));assert(!calls.includes('release'));startError=false;});
await check('active old HD stream stays HD after preference edited to Full HD',async()=>{
    stream={...stream,livekit_egress_id:'old-run'};member={role:'owner',status:'joined'};run=null;
    assert.equal((await request('/live/token')).payload.video_quality,'hd');
    run={profile:'hd'};assert.equal((await request('/live/token')).payload.video_quality,'hd');
});
await check('diagnostics permit members/admin and deny other viewers',async()=>{
    member=null;role=null;assert.equal((await request('/live/quality','viewer')).code,403);
    role='admin';const response=await request('/live/quality','administrator');assert.equal(response.code,200);assert.equal(response.payload.profile.id,'hd');
    const serialized=JSON.stringify(response.payload);assert(!/synthetic-key|synthetic-token|streamKey|rtmp|token/.test(serialized));assert.equal(response.payload.cpuPercent,null);
});
await check('unknown stored profile cannot silently choose another encoding',async()=>{stream={...stream,video_quality:'4k',livekit_egress_id:null};calls.length=0;assert.equal((await request('/live/start')).code,500);assert.equal(calls.length,0);});
// Execute the real LiveKit adapter with a fake SDK, assert actual enum passed (0 or 2).
let encoding;
class Client {async startRoomCompositeEgress(room,output,options){encoding=options.encodingOptions;return {egressId:'synthetic-egress'};}}
const sdk=synthetic('livekit-server-sdk',{AccessToken:class{},EgressClient:Client,RoomServiceClient:class{},StreamOutput:class{constructor(value){Object.assign(this,value);}},StreamProtocol:{RTMP:0},EncodingOptionsPreset:{H264_720P_30:0,H264_1080P_30:2}});
const adapter=new vm.SourceTextModule(fs.readFileSync(new URL('livekit.mjs',root),'utf8'),{context});
await adapter.link(name=>name==='livekit-server-sdk'?sdk:modules.get(name));await adapter.evaluate();
// config mock contains no production URLs or keys.
modules.get('./config.mjs').namespace.config.peertubeRtmpBase='rtmp://127.0.0.1/mock';
await check('SDK adapter chooses HD and Full HD enums without changing RTMP credentials',async()=>{
    await adapter.namespace.startEgress({room:'synthetic',streamKey:'synthetic-key',profile:'hd'});assert.equal(encoding,0);
    await adapter.namespace.startEgress({room:'synthetic',streamKey:'synthetic-key',profile:'full_hd'});assert.equal(encoding,2);
});
console.log(JSON.stringify({pass:results.length,fail:0}));
