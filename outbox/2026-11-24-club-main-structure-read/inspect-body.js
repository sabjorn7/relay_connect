'use strict';
// parse is the bundled Babel parser; source is NEVER evaluated or imported.
let ast;
try {ast=parse(source,{sourceType:'unambiguous',plugins:['typescript'],tokens:true,errorRecovery:false,allowAwaitOutsideFunction:true});}
catch{return {error:'typescript_parse_failed'};}
const names=new Set(['EdgeRuntime','userWorkers','create','Deno','env','get','toObject','Object','entries','fromEntries','assign','keys','values','Array','from','map','filter','reduce','push','concat','slice','split','join','replace','replaceAll','startsWith','endsWith','includes','URL','pathname','searchParams','getAll','req','request','url','functionName','servicePath','envVars','memoryLimitMb','workerTimeoutMs','noModuleCache','importMapPath','staticPatterns','permissions','worker','fetch','length']);
const strings=new Set(['/home/deno/functions','/home/deno/functions/','checkout-pay-link','PRODAMUS_SECRET_KEY','servicePath','envVars']);
const punct=new Set('{ } ( ) [ ] . , ; : ? ?. => ... = == === != !== ++ -- + - * ** / % += -= *= /= %= && || ?? ??= &&= ||= & | ^ ~ ! << >> >>> < > <= >= <<= >>= >>>= &= |= ^= @ # ` ${'.split(' '));
const keywords=new Set('break case catch continue debugger default do else finally for function if return switch throw try var const while with new this super class extends export import null true false in instanceof typeof void delete let yield async await static get set of'.split(' '));
const aliases=new Map();
function alias(value){if(names.has(value))return value;if(!aliases.has(value))aliases.set(value,'id_'+String(aliases.size+1).padStart(3,'0'));return aliases.get(value);}
function safeToken(t){
 const label=t.type?.label;
 if(typeof t.type==='string')return null; // comments
 if(label==='name'||label==='privateName')return alias(String(t.value));
 if(label==='string')return JSON.stringify(strings.has(t.value)?t.value:'<redacted-string>');
 if(label==='template')return strings.has(t.value)?t.value:'<redacted-template>';
 if(['num','bigint','decimal'].includes(label))return '0/*redacted-number*/';
 if(label==='regexp')return '/REDACTED/';
 if(keywords.has(t.type?.keyword))return t.type.keyword;
 if(punct.has(label))return label;
 // Some operator token labels group several operators. Export only fixed values.
 if(typeof t.value==='string'&&punct.has(t.value))return t.value;
 if(label==='eof')return null;
 return '<redacted-token>';
}
const tokens=ast.tokens.map(t=>({start:t.start,end:t.end,safe:safeToken(t)}));
function fragment(n){
 let code=tokens.filter(t=>t.start>=n.start&&t.end<=n.end&&t.safe!==null).map(t=>t.safe).join(' ');
 const truncated=code.length>12000;if(truncated)code=code.slice(0,12000);
 return {start_line:n.loc.start.line,end_line:n.loc.end.line,redacted_code:code,truncated};
}
function walk(n,visit){if(!n||typeof n!=='object')return;if(typeof n.type==='string')visit(n);for(const [k,v] of Object.entries(n)){if(['loc','start','end','tokens','comments','leadingComments','trailingComments','innerComments','extra'].includes(k))continue;if(Array.isArray(v))for(const x of v)walk(x,visit);else if(v&&typeof v==='object')walk(v,visit);}}
function chain(n){
 if(n?.type==='Identifier')return n.name;
 if(['MemberExpression','OptionalMemberExpression'].includes(n?.type)){
  const key=n.computed?(n.property.type==='StringLiteral'?n.property.value:''):n.property.name;
  return key?chain(n.object)+'.'+key:'';
 }return '';
}
const calls=[],defs=[],mutations=[];
walk(ast.program,n=>{
 if(['CallExpression','OptionalCallExpression'].includes(n.type)&&chain(n.callee)==='EdgeRuntime.userWorkers.create')calls.push(n);
 if(n.type==='VariableDeclarator'||n.type==='FunctionDeclaration'&&n.id)defs.push(n);
 if(['AssignmentExpression','UpdateExpression'].includes(n.type))mutations.push(n);
 if(n.type==='CallExpression'&&['push','assign','set','delete','splice'].includes(n.callee?.property?.name))mutations.push(n);
});
function ids(n){const out=new Set();walk(n,x=>{if(x.type==='Identifier')out.add(x.name);});return out;}
const wanted=new Set(['servicePath','envVars']);for(const call of calls)for(const arg of call.arguments)for(const id of ids(arg))wanted.add(id);
const selected=new Set();for(let depth=0;depth<5;depth++){
 let added=false;for(const d of defs){if(selected.has(d)||![...ids(d.id)].some(x=>wanted.has(x)))continue;if(selected.size>=30)break;selected.add(d);added=true;for(const id of ids(d.init||d.body))wanted.add(id);}if(!added)break;
}
const related=mutations.filter(n=>[...ids(n.left||n.argument||n.callee?.object)].some(x=>wanted.has(x))).slice(0,20);
return {schema:'main_structure_v2',create_call_count:calls.length,create_calls:calls.slice(0,10).map(fragment),definitions:[...selected].sort((a,b)=>a.start-b.start).map(fragment),related_assignments:related.map(fragment),redaction:'unknown_names_aliased_literals_redacted_comments_removed',limits:{dependency_depth:5,definitions:30,assignments:20,calls:10,fragment_characters:12000},scope:'syntactic_fragments_not_scope_or_control_flow_proof'};
