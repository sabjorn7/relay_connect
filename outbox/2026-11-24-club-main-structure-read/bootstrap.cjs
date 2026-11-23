const fs=require('node:fs'),crypto=require('node:crypto');
try {
 const raw=fs.readFileSync(0);if(raw.length>2097152)throw Error();
 const input=JSON.parse(raw);
 const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
 if(sha(input.parser)!=='__PARSER_SHA__'||sha(input.inspector)!=='__INSPECTOR_SHA__')throw Error();
 const parserExports={};new Function('exports',input.parser)(parserExports);
 // Only approved parser/inspector code is compiled. Main is passed as data.
 const report=new Function('parse','source',input.inspector)(parserExports.parse,input.source);
 process.stdout.write(JSON.stringify(report));if(report.error)process.exitCode=2;
} catch {process.stdout.write(JSON.stringify({error:'safe_parser_failed'}));process.exitCode=2;}
