// Public read-only browser smoke. No login, registration, payments or form submission.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const expected='1d8364f7721cb0e9eeefaad815f1d1469af6ead7';
const results=[];
for(const engine of ['Chrome','WebKit']){
 const browser=engine==='Chrome'?await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}):await webkit.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  for(const route of ['/','/all_course/','/login/','/registration/']){
   const page=await context.newPage();const errors=[],assetErrors=[],failedAssets=[];let autoReports=0;
   page.on('pageerror',e=>errors.push(e.name));
   page.on('response',r=>{if(['script','stylesheet'].includes(r.request().resourceType())&&r.status()>=400)assetErrors.push({type:r.request().resourceType(),status:r.status()});});
   page.on('requestfailed',r=>{if(['script','stylesheet'].includes(r.resourceType())){const u=new URL(r.url());failedAssets.push({type:r.resourceType(),host:u.hostname,path:u.pathname,error:r.failure()?.errorText});}});
   page.on('request',r=>{if(new URL(r.url()).pathname==='/_l/session-v1'&&r.method()==='POST')autoReports++;});
   let record={engine,route};
   try{
    const response=await page.goto('https://app.meetgu.ru'+route,{waitUntil:'domcontentloaded',timeout:60000});
    const html=await response.text();
    record.http=response.status();record.release=html.match(/release:\s*["']([0-9a-f]{40})["']/)?.[1]||null;
    assert.equal(record.release,expected,'published release mismatch');
    await page.waitForFunction(()=>!!document.querySelector('#app[data-v-app]'),{},{timeout:45000});
    await page.locator('#mg-boot-loading').waitFor({state:'hidden',timeout:10000});
    if(route==='/login/'||route==='/registration/')await page.locator('input[type=email]').waitFor({state:'visible',timeout:15000});
    else await page.locator('h1').first().waitFor({state:'visible',timeout:15000});
    await page.waitForTimeout(1500);
    record={...record,mounted:true,preloaderHidden:true,emailInputs:await page.locator('input[type=email]').count(),passwordInputs:await page.locator('input[type=password]').count(),pageErrors:errors,assetErrors,failedAssets,automaticReports:autoReports};
    assert.equal(record.http,200);assert.deepEqual(errors,[]);assert.deepEqual(assetErrors,[]);assert.deepEqual(failedAssets,[]);
    record.pass=true;
   }catch(e){record={...record,pass:false,failure:e.name,reason:e.message.slice(0,250),pageErrors:errors,assetErrors,failedAssets};}
   results.push(record);console.log(JSON.stringify(record));await page.close();
  }
  await context.close();
 }finally{await browser.close();}
}
fs.writeFileSync('/private/tmp/mg-auth-production-smoke-20261124.json',JSON.stringify({expected,results,realLogin:'NOT TESTED: no approved test credentials available',payments:'NOT PERFORMED'},null,2)+'\n');
assert(results.every(r=>r.pass),'public smoke failed');
