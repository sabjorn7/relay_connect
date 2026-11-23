const fs=require('node:fs'),crypto=require('node:crypto');
try {
 const raw=fs.readFileSync(0);if(raw.length>2097152)throw Error();const input=JSON.parse(raw);
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 if(sha(input.parser)!=='__PARSER_SHA__'||sha(input.patcher)!=='__PATCHER_SHA__')throw Error();
 const exports={};new Function('exports',input.parser)(exports);
 const result=new Function('parse','source',input.patcher)(exports.parse,input.source);
 process.stdout.write(JSON.stringify(result));if(result.error)process.exitCode=2;
}catch{process.stdout.write('{"error":"safe_patcher_failed"}');process.exitCode=2;}
