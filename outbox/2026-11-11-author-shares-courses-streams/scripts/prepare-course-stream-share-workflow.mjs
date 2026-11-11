import fs from 'node:fs';
import {patchAuthorShareWorkflows} from './lib/author-share-workflows.mjs';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: <protected BuyCourse export> <new protected output file>');
let w=JSON.parse(fs.readFileSync(input));w=Array.isArray(w)?w[0]:(w.data??w);
const baseline=JSON.parse(fs.readFileSync(new URL('../reviews/2026-11-10-author-shares/baseline/financial-nodes.json',import.meta.url)));
const result=patchAuthorShareWorkflows(w,undefined,baseline).BuyCourse;
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log('Prepared BuyCourse only; no network or subscription changes.');
