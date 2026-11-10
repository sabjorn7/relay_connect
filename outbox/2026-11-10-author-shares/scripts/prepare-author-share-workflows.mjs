// LOCAL FILE TRANSFORM ONLY. Never connects to n8n or Supabase.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {patchAuthorShareWorkflows} from './lib/author-share-workflows.mjs';
export {patchAuthorShareWorkflows};
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [buyFile,clubFile,outDir]=process.argv.slice(2);if(!buyFile||!clubFile||!outDir)throw Error('Usage: node scripts/prepare-author-share-workflows.mjs <protected BuyCourse.json> <protected subscription.json> <new output dir>');
 const read=p=>{const j=JSON.parse(fs.readFileSync(p));if(Array.isArray(j)){if(j.length!==1)throw Error('Exactly one workflow per file');return j[0];}return j.data??j;};
 const baseline=JSON.parse(fs.readFileSync(new URL('../reviews/2026-11-10-author-shares/baseline/financial-nodes.json',import.meta.url)));
 const result=patchAuthorShareWorkflows(read(buyFile),read(clubFile),baseline);fs.mkdirSync(outDir,{mode:0o700});
 for(const [name,w] of Object.entries(result))fs.writeFileSync(path.join(outDir,name+'.protected.json'),JSON.stringify(w,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log('Prepared two protected exports locally. No network calls. Do not publish these exports.');
}
