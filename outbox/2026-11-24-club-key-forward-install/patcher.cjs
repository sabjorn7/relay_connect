'use strict';
// parse/source supplied by a checksum-verified bootstrap; source is not executed.
const replacement='envVars: await (await import("./club-key-env.mjs")).clubWorkerEnv(servicePath, envVars)';
const options={sourceType:'module',plugins:['typescript'],errorRecovery:false,allowAwaitOutsideFunction:true};
let ast;try{ast=parse(source,options);}catch{return {error:'source_parse_failed'};}
function chain(n){if(n?.type==='Identifier')return n.name;if(n?.type==='MemberExpression'&&!n.computed)return chain(n.object)+'.'+n.property.name;return '';}
const calls=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='CallExpression'&&chain(n.callee)==='EdgeRuntime.userWorkers.create')calls.push(n);for(const [k,v] of Object.entries(n)){if(['loc','start','end','comments','leadingComments','trailingComments','innerComments','extra'].includes(k))continue;if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}}walk(ast.program);
if(calls.length!==1)return {error:'unexpected_create_call_count'};
const call=calls[0];if(call.arguments.length!==1||call.arguments[0].type!=='ObjectExpression')return {error:'unexpected_create_argument'};
const properties=call.arguments[0].properties;
const expected=['servicePath','memoryLimitMb','workerTimeoutMs','noModuleCache','importMapPath','envVars'];
if(properties.length!==expected.length||!properties.every((p,i)=>p.type==='ObjectProperty'&&!p.computed&&p.shorthand&&p.key.type==='Identifier'&&p.key.name===expected[i]&&p.value.type==='Identifier'&&p.value.name===expected[i]))return {error:'unexpected_create_parameters'};
const property=properties[5];if(source.slice(property.start,property.end)!=='envVars')return {error:'unexpected_env_property_text'};
const updated=source.slice(0,property.start)+replacement+source.slice(property.end);
try{parse(updated,options);}catch{return {error:'patched_parse_failed'};}
return {start_byte:Buffer.byteLength(source.slice(0,property.start),'utf8'),end_byte:Buffer.byteLength(source.slice(0,property.end),'utf8'),replacement,syntax_valid:true};
