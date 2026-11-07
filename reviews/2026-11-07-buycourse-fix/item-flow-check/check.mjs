import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const VENDOR=path.join(ROOT,'vendor');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'source-manifest.json'),'utf8'));
for(const [name,expected]of Object.entries(manifest.files)){
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(VENDOR,name))).digest('hex'),expected.sha256,'upstream source hash: '+name);
}
const packageRoot=process.argv[2] || path.dirname(ROOT);
const workflow=JSON.parse(fs.readFileSync(path.join(packageRoot,'reviews/2026-11-07-multicourse-access/BuyCourse.fixed.review.json'),'utf8'));
function source(p){return fs.readFileSync(path.join(VENDOR,p),'utf8');}
class TestError extends Error {constructor(message,extra){super(typeof message==='string'?message:JSON.stringify(extra||message));Object.assign(this,extra);}}
function load(p,names,globals={}){
  const js=stripTypeScriptTypes(source(p),{mode:'transform'}).replace(/^import[\s\S]*?from\s*['"][^'"]+['"];\s*/gm,'').replace(/^export\s+/gm,'');
  return vm.runInNewContext(js+'\n;({'+names.join(',')+'})',{console,process:{env:{}},structuredClone,EventEmitter,...globals},{filename:p});
}
const date={now:()=>({set:()=>({})})};
const {WorkflowDataProxy}=load('packages/workflow/src/WorkflowDataProxy.ts',['WorkflowDataProxy'],{
  jmespath:{},DateTime:date,Duration:{},Interval:{},Settings:{},
  augmentArray:x=>x,augmentObject:x=>x,SCRIPTING_NODE_TYPES:['n8n-nodes-base.code'],AGENT_LANGCHAIN_NODE_TYPE:'unused',
  ApplicationError:TestError,ExpressionError:TestError,getGlobalState:()=>({defaultTimezone:'UTC'}),NodeConnectionTypes:{Main:'main'},
  NodeHelpers:{},deepCopy:structuredClone,isObjectEmpty:x=>!Object.keys(x||{}).length,
  createEnvProvider:()=>({}),createEnvProviderState:()=>({}),getPinDataIfManualExecution:()=>undefined,
});
const generic=load('packages/nodes-base/nodes/Supabase/GenericFunctions.ts',['buildGetQuery','buildOrQuery','buildQuery','mapPairedItemsFrom'],{NodeApiError:TestError});
let request;
const {Supabase}=load('packages/nodes-base/nodes/Supabase/Supabase.node.ts',['Supabase'],{
  ...generic,NodeConnectionTypes:{Main:'main'},NodeOperationError:TestError,
  rowFields:[],rowOperations:[],validateCredentials:()=>{},supabaseApiRequest:async function(...args){return request.call(this,...args);},
});
const {getSandboxContext}=load('packages/nodes-base/nodes/Code/Sandbox.ts',['getSandboxContext'],{isObject:x=>x!==null&&typeof x==='object',ValidationError:TestError});
// Real Code dispatcher; the VM2 security boundary is replaced by node:vm for synthetic code only.
class MockSandbox extends EventEmitter {
  constructor(context,code){super();this.context=context;this.code=code;}
  async runCodeAllItems(){const items=await vm.runInNewContext('(async()=>{'+this.code+'\n})()',this.context);assert(Array.isArray(items));return items;}
}
const {Code}=load('packages/nodes-base/nodes/Code/Code.node.ts',['Code'],{
  TaskRunnersConfig:class{},Container:{get:()=>({enabled:false})},set:(obj,k,v)=>obj[k]=v,
  NodeConnectionTypes:{Main:'main'},javascriptCodeDescription:[],pythonCodeDescription:[],getSandboxContext,
  JavaScriptSandbox:MockSandbox,PythonSandbox:MockSandbox,JsTaskRunnerSandbox:MockSandbox,
  addPostExecutionWarning:()=>{},standardizeOutput:x=>x,
});
const supabase=new Supabase();const code=new Code();
const chain=['Code','GetPositions','GetCourse','UsersCreater','UsersBuyer','BuildAllAccesses'];
const byName=Object.fromEntries(workflow.nodes.map(n=>[n.name,n]));
const inputs=new Map();for(const [from,types]of Object.entries(workflow.connections))for(const [branch,links]of (types.main||[]).entries())for(const link of links){const rows=inputs.get(link.node)||[];rows.push({from,branch});inputs.set(link.node,rows);}
function parents(name,seen=new Set()) {for(const row of inputs.get(name)||[]){if(!seen.has(row.from)){seen.add(row.from);parents(row.from,seen);}}return [...seen];}
const graph={...workflow,nodes:byName,settings:{executionOrder:'v1',timezone:'UTC'},getNode:n=>byName[n]||null,getParentNodes:parents,getParentMainInputNode:n=>n,
  getNodeConnectionIndexes:(active,previous)=>parents(active).includes(previous)?{sourceIndex:0,destinationIndex:0}:undefined};
function dataProxy(state,node,index,incoming,previous){return new WorkflowDataProxy(graph,{resultData:{runData:state}},0,index,node.name,incoming,node.parameters,'webhook',{}, {node,source:{main:[{previousNode:previous,previousNodeOutput:0,previousNodeRun:0}]}},-1).getDataProxy();}
function context(state,node,incoming,previous){
  const helpers={returnJsonArray:rows=>(Array.isArray(rows)?rows:[rows]).map(json=>({json})),constructExecutionMetaData:(rows,{itemData})=>rows.map(row=>({...row,pairedItem:itemData})),httpRequestWithAuthentication(){throw Error('network forbidden');},requestWithAuthenticationPaginated(){throw Error('network forbidden');}};
  const defaults={resource:'row',mode:'runOnceForAllItems',language:'javaScript'};
  return {node,getNode:()=>node,getInputData:()=>incoming,getMode:()=> 'webhook',getWorkflow:()=>graph,getWorkflowStaticData:()=>({}),getWorkflowDataProxy:i=>dataProxy(state,node,i,incoming,previous),sendMessageToUI(){},continueOnFail:()=>false,helpers,
    getNodeParameter(name,index,fallback){
      let value=name.split('.').reduce((v,k)=>v?.[k],node.parameters)??defaults[name]??fallback;
      const p=dataProxy(state,node,index,incoming,previous);
      const evaluate=v=>{
        if(typeof v==='string' && v.startsWith('={{') && v.endsWith('}}'))return vm.runInNewContext('('+v.slice(3,-2)+')',p);
        if(Array.isArray(v))return v.map(evaluate);
        if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,evaluate(x)]));return v;
      };return evaluate(value);
    }};
}
function store(state,name,items,previous){state[name]=[{data:{main:[items]},source:previous?[{previousNode:previous,previousNodeOutput:0,previousNodeRun:0}]:[],executionStatus:'success'}];}
function seed(count=4){
  const order={id:'synthetic-order',owner:'synthetic-buyer',course_positions:Array.from({length:count},(_,i)=>'p'+i)};
  const shops=order.course_positions.map((id,i)=>({id,owner:order.owner,course_id:'c'+i,price:100+i}));
  const courses=shops.map((p,i)=>({id:p.course_id,owner:'a'+(i%2),Title:'Synthetic',DurationLong:6}));
  return {order,shops,courses,users:[{id:order.owner},{id:'a0',authorCommission:70},{id:'a1',authorCommission:50}]};
}
async function run(data,options={}){
  const state={};store(state,'CheckPaid',[{json:data.order}]);store(state,'Supabase',[{json:data.order}],'CheckPaid');
  const counts={};const calls=[];const pairedOwners=[];
  request=async function(method,endpoint,body,qs){
    assert.equal(method,'GET');assert.equal(Object.keys(qs).join(','),'id');
    const table=endpoint.slice(1);const rows=table==='shop'?data.shops:table==='course'?data.courses:data.users;
    calls.push({node:this.node.name,id:qs.id});
    return structuredClone(rows.filter(row=>'eq.'+row.id===qs.id));
  };
  let incoming=[{json:data.order}];let previous='Supabase';
  for(const name of chain){
    const node=byName[name];
    // workflow-execute rewrites input pairedItem to its current index before node execution.
    incoming=incoming.map((item,index)=>({...item,pairedItem:{item:index}}));
    if(node.executeOnce)incoming=incoming.slice(0,1);
    if(!incoming.length) return {state,counts,calls,plan:null,stoppedAt:name};
    if(name==='UsersBuyer')for(let i=0;i<incoming.length;i++)pairedOwners.push(dataProxy(state,node,i,incoming,previous).$('GetPositions').item.json.owner);
    const result=await (node.type==='n8n-nodes-base.code'?code:supabase).execute.call(context(state,node,incoming,previous));
    incoming=result[0];store(state,name,incoming,previous);counts[name]=incoming.length;previous=name;
    if(options.dropAt===name) incoming=incoming.slice(0,-1);
  }
  return {state,counts,calls,pairedOwners,plan:incoming[0].json.plan};
}
const results=[];
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS '+name);}catch(e){results.push({name,status:'FAIL',reason:e.stack});console.error('FAIL '+name+' '+e.stack);}}
await check('actual fixed graph is one acyclic single-output path, without executeOnce or item-by-item Code',()=>{
  for(let i=0;i<chain.length;i++){
    const n=byName[chain[i]];assert(!n.executeOnce&&!n.disabled&&!n.continueOnFail);
    assert(!parents(n.name).includes(n.name),'no loop can split data between separate runs');
    if(n.type==='n8n-nodes-base.code')assert.equal(n.parameters.mode??'runOnceForAllItems','runOnceForAllItems');
    if(i>0)assert.deepEqual(inputs.get(n.name),[{from:chain[i-1],branch:0}]);
    if(i<chain.length-1)assert.deepEqual(workflow.connections[n.name].main,[[{node:chain[i+1],type:'main',index:0}]]);
  }
  assert.deepEqual(inputs.get('Code'),[{from:'Supabase',branch:0}]);
});
await check('one purchased course reaches BuildAllAccesses',async()=>{const r=await run(seed(1));assert.equal(r.plan.length,1);assert(Object.values(r.counts).every(n=>n===1));});
await check('four courses: 4 -> 4 -> 4 -> 4 -> 4 -> one complete plan',async()=>{
  const r=await run(seed());assert.deepEqual(r.counts,{Code:4,GetPositions:4,GetCourse:4,UsersCreater:4,UsersBuyer:4,BuildAllAccesses:1});assert.equal(r.plan.length,4);
  assert.deepEqual(Array.from(r.plan,p=>p.shop_id),['p0','p1','p2','p3']);assert.deepEqual(r.pairedOwners,Array(4).fill('synthetic-buyer'));
  assert.equal(r.calls.length,16);assert.deepEqual(Array.from(r.plan,p=>p.author_id),['a0','a1','a0','a1']);
});
await check('repeated author IDs remain four linked items; all courses use their own author',async()=>{const d=seed();d.courses.forEach(c=>c.owner='a0');const r=await run(d);assert.equal(r.counts.UsersCreater,4);assert.equal(r.plan.length,4);assert(r.plan.every(p=>p.author_id==='a0'));});
await check('multiple positions of the same course are retained',async()=>{const d=seed();d.shops[1].course_id='c0';const r=await run(d);assert.equal(r.plan.length,4);assert.equal(r.plan[1].course_id,'c0');});
await check('Supabase pairedItem links remain correct when an upstream lookup returns no row',async()=>{
  const d=seed();d.courses=d.courses.filter(c=>c.id!=='c1');await assert.rejects(run(d),/Missing course or author/);
});
await check('missing paid shop position fails closed before a transaction can be called',async()=>{const d=seed();d.shops.pop();await assert.rejects(run(d),/Missing or ambiguous shop position/);});
await check('all() is not filtered to current paired item and uses the latest run by default',async()=>{
  const r=await run(seed());const p=dataProxy(r.state,byName.BuildAllAccesses,0,r.state.UsersBuyer[0].data.main[0].map((x,i)=>({...x,pairedItem:{item:i}})),'UsersBuyer');
  assert.equal(p.$('GetPositions').all().length,4);
  r.state.GetPositions.push({data:{main:[[{json:{id:'second-run'}}]]},source:[]});
  assert.equal(p.$('GetPositions').all().length,1);assert.equal(p.$('GetPositions').all(0,0).length,4);
});
await check('all() follows connected output branch and never silently reads branch zero',async()=>{
  const r=await run(seed());r.state.GetPositions[0].data.main.push([{json:{id:'branch-one'}}]);
  const original=graph.getNodeConnectionIndexes;graph.getNodeConnectionIndexes=(active,prev)=>prev==='GetPositions'?{sourceIndex:1,destinationIndex:0}:original(active,prev);
  try {const p=dataProxy(r.state,byName.BuildAllAccesses,0,r.state.UsersBuyer[0].data.main[0],'UsersBuyer');assert.equal(p.$('GetPositions').all()[0].json.id,'branch-one');assert.equal(p.$('GetPositions').all(0).length,4);}finally{graph.getNodeConnectionIndexes=original;}
});
await check('unexecuted node raises instead of returning an invented or partial item list',async()=>{
  const r=await run(seed());delete r.state.GetPositions;const p=dataProxy(r.state,byName.BuildAllAccesses,0,r.state.UsersBuyer[0].data.main[0],'UsersBuyer');assert.throws(()=>p.$('GetPositions').all(),/unexecuted/);
});
fs.writeFileSync(path.join(ROOT,'results.json'),JSON.stringify(results,null,2)+'\n');
const fail=results.filter(r=>r.status==='FAIL').length;console.log(JSON.stringify({pass:results.length-fail,fail}));if(fail)process.exitCode=1;
