/** Explicit, one bounded anonymous browser exercise; never a default test. */
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from '../../test/web/fixture-server.ts';
import {cacheProof} from '../../test/web/cache-proof.ts';
import assert from 'node:assert/strict';
import {createPreview} from './preview.ts';
import type {PreviewTask} from './preview.ts';
if(!['--live','--live yocto'].includes(process.argv.slice(2).join(' ')))throw new Error('explicit --live required');
const saved=JSON.parse(await readFile('artifacts/discovery-v2/phase1d-live/receipt.json','utf8'));
const prior=saved.requests?.at(-1)?.headers;
if(prior?.['x-ratelimit-remaining']==='0'&&Number(prior['x-ratelimit-reset'])*1000>Date.now())throw new Error('saved anonymous reset still pending; no request attempted');
const preview=createPreview(),app=await fixtureServer({previewHandler:preview.handler}),browser=await chromium.launch();
const repository=process.argv[3]==='yocto'?'sindresorhus/yocto-queue':'sindresorhus/p-limit';
const out=resolve(process.argv[3]==='yocto'?'artifacts/deep-search/live-yocto':'artifacts/deep-search/live');await mkdir(out,{recursive:true});
const tasks:PreviewTask[]=[];const errors:string[]=[];const started=Date.now();
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(r.url().includes('/api/deep-search/tasks/')&&r.request().method()==='GET'){const task=await r.json() as PreviewTask;if(task.state!=='running'&&!tasks.some(t=>t.id===task.id))tasks.push(task);}});
 await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();
 const cacheBefore=await cacheProof(app.fixtureCacheRoot);
 await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill(repository);await page.locator('#deep-search-submit').click();
 await page.waitForFunction(()=>/^search: (completed|partial|cancelled)/.test(document.querySelector('#deep-status')?.textContent??''),null,{timeout:35000});
 const count=await page.locator('#deep-candidates input:not(:disabled)').count();
 if(count&&tasks[0]?.search?.result?.attempts.every(a=>a.outcome==='success')){
  await page.waitForTimeout(15500);await page.locator('#deep-candidates input:not(:disabled)').first().check();await page.locator('#deep-compare').click();
  await page.waitForFunction(()=>/^compare: (completed|partial|cancelled)/.test(document.querySelector('#deep-status')?.textContent??''),null,{timeout:35000});
 }
 await page.screenshot({path:resolve(out,'1280-live.png'),fullPage:true});
 const text=await page.locator('#deep-dialog').innerText();await page.locator('#deep-back').click();
 const cacheAfter=await cacheProof(app.fixtureCacheRoot);assert.deepEqual(cacheAfter,cacheBefore);
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({mode:'explicit anonymous real GitHub; standard Graph uses the existing local fixture',startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,tasks,text,errors,cacheBefore,cacheAfter,cacheUnchanged:true},null,2));
 console.log(JSON.stringify({tasks:tasks.map(t=>({kind:t.kind,state:t.state,error:t.error,candidates:t.search?.result?.candidates.map(c=>c.candidate.fullName),comparisons:t.comparison?.content.comparisons.map(c=>({name:c.name,measurements:c.candidate?.similarity.map(m=>({method:m.method,score:m.score}))}))})),errors}));
}finally{await preview.close();await browser.close();await app.cleanup();}
