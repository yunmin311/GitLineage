/** Explicit anonymous real multi-file browser exercise. Never part of default tests. */
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {fixtureServer,A} from '../../test/web/fixture-server.ts';
import {cacheProof} from '../../test/web/cache-proof.ts';
import {createPreview} from './preview.ts';
import type {PreviewTask} from './preview.ts';
import {validatePreviewExport,validateSourceExport} from './preview-contract.ts';
if(process.argv.slice(2).join(' ')!=='--live')throw new Error('explicit --live required');
const prior=await readFile('docs/experiments/m2-alpha/live-yocto.json','utf8');
const resets=[...prior.matchAll(/"x-ratelimit-reset":\s*"(\d+)"/g)].map(m=>Number(m[1])*1000);
if(prior.includes('"x-ratelimit-remaining": "0"')&&Math.max(...resets)>Date.now())throw new Error('saved anonymous reset pending; no request attempted');
const out=resolve('artifacts/m2-beta/live');await mkdir(out,{recursive:true});
const preview=createPreview(),app=await fixtureServer({previewHandler:preview.handler}),browser=await chromium.launch();
const tasks:PreviewTask[]=[],errors:string[]=[];const started=Date.now();let outcome='partial',reason='',downloaded=false;
try{
 const page=await browser.newPage({viewport:{width:1280,height:1080}});page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(r.url().includes('/api/deep-search/tasks/')&&r.request().method()==='GET'){const task=await r.json() as PreviewTask;if(task.state!=='running'&&!tasks.some(t=>t.id===task.id))tasks.push(task);}});
 await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();
 const cacheBefore=await cacheProof(app.fixtureCacheRoot),viewBox=await page.locator('#canvas').getAttribute('viewBox'),url=page.url();
 try{
  await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('sindresorhus/yocto-queue');await page.locator('#deep-search-submit').click();
  await page.waitForFunction(()=>/^search: (completed|partial|cancelled)/.test(document.querySelector('#deep-status')?.textContent??''),null,{timeout:35000});
  const search=tasks.find(t=>t.kind==='search');
  if(!search?.search?.result?.attempts.every(a=>a.outcome==='success')||!await page.locator('#deep-candidates input:not(:disabled)').count())throw new Error('search incomplete or quota unavailable');
  await page.locator('#deep-candidates input:not(:disabled)').first().check();await page.locator('#deep-source-preview').click({timeout:20000});
  await page.locator('#deep-source-download').waitFor({timeout:35000});
  const sources=tasks.find(t=>t.kind==='sources');if(!sources?.sources)throw new Error('source listing unavailable');
  if(sources.sources.repositories.some(r=>r.files.filter(f=>f.selectable).length<2)){
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-source-download').click()]);await download.saveAs(resolve(out,'source-sidecar.json'));validateSourceExport(JSON.parse(await readFile(resolve(out,'source-sidecar.json'),'utf8')));throw new Error('fewer than two selectable JS/TS files in at least one repository; no extra search attempted');
  }
  for(const r of sources.sources.repositories){const paths=r.files.filter(f=>f.selectable).map(f=>f.path).sort((a,b)=>Number(!/^(index|test)\./.test(a))-Number(!/^(index|test)\./.test(b))||a.localeCompare(b)).slice(0,2);
   const checks=page.locator(`#deep-files input[data-repository="${r.repositoryId}"]:not(:disabled)`);for(let i=0;i<await checks.count();i++){const check=checks.nth(i);if(paths.includes(await check.inputValue()))await check.check();else await check.uncheck();}
  }
  await page.screenshot({path:resolve(out,'source-selection.png'),fullPage:true});await page.locator('#deep-compare').click({timeout:20000});await page.locator('#deep-download').waitFor({timeout:35000});
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-download').click()]);await download.saveAs(resolve(out,'comparison-sidecar.json'));const receipt=JSON.parse(await readFile(resolve(out,'comparison-sidecar.json'),'utf8'));validatePreviewExport(receipt);downloaded=true;
  assert.equal(receipt.probe.content.verification,'pending');assert.equal(receipt.probe.content.lineageClaim,'none');
  outcome=receipt.probe.content.snapshots.every((s:{source?:{bindings:unknown[]}})=>s.source?.bindings.length===2)&&receipt.probe.content.comparisons[0]?.summary?.comparedPairs===4?'success':'partial';
 }catch(error){reason=error instanceof Error?error.message:String(error);}
 await page.screenshot({path:resolve(out,'result.png'),fullPage:true});const text=await page.locator('#deep-dialog').innerText();await page.locator('#deep-back').click();const cacheAfter=await cacheProof(app.fixtureCacheRoot);assert.deepEqual(cacheAfter,cacheBefore);assert.equal(await page.locator('#canvas').getAttribute('viewBox'),viewBox);assert.equal(page.url(),url);
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({mode:'explicit anonymous real GitHub Search, pinned trees and blobs; Graph alone uses local fixture',repository:'sindresorhus/yocto-queue',startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,outcome,reason,downloaded,tasks,text,errors,cacheBefore,cacheAfter,cacheUnchanged:true},null,2));
 console.log(JSON.stringify({outcome,reason,downloaded,tasks:tasks.map(t=>({kind:t.kind,state:t.state,error:t.error,usage:(t.search??t.sources??t.comparison?.content)?.usage})),errors}));
}finally{await preview.close();await browser.close();await app.cleanup();}
