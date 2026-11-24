// Run from the patched application checkout. Uses existing test sources unchanged,
// replacing only their obsolete absolute Playwright import in temporary siblings.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const modulePath=process.env.PLAYWRIGHT_MODULE;
if (!modulePath || !fs.existsSync(modulePath)) throw new Error('Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs');
for (const name of ['chat-links.browser.mjs','group-chat-authors.browser.mjs','chat-previews.browser.mjs']) {
    const original=path.resolve('tests',name);
    const temp=path.resolve('tests',`club-regression-${randomUUID()}.mjs`);
    const source=fs.readFileSync(original,'utf8').replace("'/private/tmp/mg-browser-tools-kFSaYv/node_modules/playwright/index.mjs'",JSON.stringify(modulePath));
    fs.writeFileSync(temp,source,{flag:'wx'});
    let result;
    try { result=spawnSync(process.execPath,[temp],{stdio:'inherit'}); }
    finally { fs.unlinkSync(temp); }
    if (result.status !== 0) process.exit(result.status || 1);
}
