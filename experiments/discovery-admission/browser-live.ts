/** Explicit real GitHub through the built application's existing local authorization. */
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixtureServer,A} from '../../test/web/fixture-server.ts';
import {createPreview} from '../discovery-v2/preview.ts';
import type {PreviewTask} from '../discovery-v2/preview.ts';
import {validateReviewReceipt} from '../discovery-v2/review-receipt.ts';
if(process.argv[2]!=='--live')throw new Error('explicit --live required');
const token=execFileSync('gh',['auth','token'],{encoding:'utf8'}).trim();
// Supplementary fork and abstention controls are not included in admission metrics.
const allCases=[['sindresorhus/p-limit',1280,'leejialing/limit-promise'],['chalk/chalk',390,'jaywcjlove/colors-cli'],['vitejs/vite',1280,'module-federation/vite'],['gin-gonic/gin',390,'xgfone/ship'],['pallets/flask',1280,'pallets/quart'],['jucke/p-limit',390,'sindresorhus/p-limit'],['octocat/Spoon-Knife',390,''],['yunmin311/GitLineage',1280,'']] as const;
const cases=process.argv[4]?allCases.filter(c=>process.argv[4]!.split(',').includes(c[0])):allCases;
const out=process.argv[3]??'artifacts/discovery-admission/live';await mkdir(out,{recursive:true});
await writeFile(out+'/started.json',JSON.stringify({startedAt:new Date().toISOString(),cases,scope:'actual GitHub; Graph background alone uses a cached fixture; no acquired code execution'}),{flag:'wx'});
const browser=await chromium.launch(),results=[];
try{for(const [repository,width,preferred] of cases){
 const requests:any[]=[],tasks:PreviewTask[]=[],pendingTasks:Promise<void>[]=[],errors:string[]=[];const started=performance.now(),prefix=`${out}/${repository.replace('/','--')}`;
 const preview=createPreview({enrichedSearch:true,cooldownMs:0,transport:async(url,init)=>{
  assert.equal(new URL(url).origin,'https://api.github.com');const start=performance.now(),headers=new Headers(init.headers);headers.set('authorization',`Bearer ${token}`);
  const response=await fetch(url,{...init,headers}),receipt={url,status:response.status,bytes:0,wallMs:0,cancelled:false,body:null as unknown};requests.push(receipt);const chunks:Buffer[]=[];
  const reader=response.body?.getReader();if(!reader)return response;
  return new Response(new ReadableStream({async pull(controller){const r=await reader.read();if(r.done){receipt.wallMs=performance.now()-start;try{receipt.body=JSON.parse(Buffer.concat(chunks).toString());}catch{}controller.close();}else{receipt.bytes+=r.value.byteLength;if(receipt.bytes<=32768)chunks.push(Buffer.from(r.value));controller.enqueue(r.value);}},async cancel(){receipt.cancelled=true;receipt.wallMs=performance.now()-start;await reader.cancel();}}),{status:response.status,headers:response.headers});
 }}),app=await fixtureServer({previewHandler:preview.handler}),page=await browser.newPage({viewport:{width,height:932},reducedMotion:'reduce',isMobile:width<768,hasTouch:width<768});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.request().method()==='GET'&&r.url().includes('/api/deep-search/tasks/'))pendingTasks.push((async()=>{const t=await r.json() as PreviewTask;if(t.state!=='running'&&!tasks.some(x=>x.id===t.id))tasks.push(t);})());});
 let outcome='partial',reason='',downloaded=false,selected:string|null=null;
 try{
  await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill(repository);await page.locator('#deep-search-submit').click();
  await page.waitForFunction(()=>/^Candidate search ·/.test(document.querySelector('#deep-status')?.textContent??'')&&['completed','partial','cancelled','failed'].includes((document.querySelector('#deep-status') as HTMLElement)?.dataset.state??''),null,{timeout:35000});
  await Promise.all(pendingTasks);
  await page.screenshot({path:prefix+'-search.png',fullPage:true});const result=tasks.find(t=>t.kind==='search')?.search?.result;
  if(!result?.candidates.length)throw new Error('no admitted candidate; see original search/failure receipt');
  const c=result.candidates.find(c=>c.candidate.fullName===preferred)||result.candidates[0]!;selected=c.candidate.fullName;
  await page.locator(`#deep-candidates input[value="${c.candidate.repositoryId}"]`).check();await page.locator('#deep-source-preview').click();
  await page.waitForFunction(()=>/^Source listing ·/.test(document.querySelector('#deep-status')?.textContent??'')&&['completed','partial','cancelled','failed'].includes((document.querySelector('#deep-status') as HTMLElement)?.dataset.state??''),null,{timeout:35000});
  await Promise.all(pendingTasks);const sources=tasks.find(t=>t.kind==='sources')?.sources;
  if(!sources?.repositories.length)throw new Error('source listing unavailable');
  for(const r of sources.repositories){const selectable=r.files.filter(f=>f.selectable);if(!selectable.length)throw new Error(`no supported selectable source for ${r.fullName}; language/parser/listing coverage is limited`);
   // Reproducible manual review: keep at most two of the existing recommendation.
   const chosen=page.locator(`#deep-files input[data-repository="${r.repositoryId}"]:checked`);
   const count=await chosen.count();for(let i=count-1;i>=2;i--)await chosen.nth(i).uncheck();
   if(!await chosen.count())await page.locator(`#deep-files input[data-repository="${r.repositoryId}"]:not(:disabled)`).first().check();
  }
  await page.screenshot({path:prefix+'-files.png',fullPage:true});await page.locator('#deep-compare').click();
  await page.waitForFunction(()=>/^Source comparison ·/.test(document.querySelector('#deep-status')?.textContent??'')&&['completed','partial','cancelled','failed'].includes((document.querySelector('#deep-status') as HTMLElement)?.dataset.state??''),null,{timeout:35000});
  await Promise.all(pendingTasks);if(await page.locator('#deep-review-download').count()){
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-review-download').click()]);await download.saveAs(prefix+'-review.json');const receipt=JSON.parse(await readFile(prefix+'-review.json','utf8'));validateReviewReceipt(receipt.review,receipt.export);downloaded=true;
   outcome=receipt.review.comparisons.some((r:any)=>r.completedPairs>0)?'compared':'no completed pair';
  }else throw new Error('comparison produced no downloadable review');
 }catch(error){reason=error instanceof Error?error.message:String(error);}
 try{await page.screenshot({path:prefix+'-final.png',fullPage:true});const text=await page.locator('#deep-dialog').innerText(),geometry=await page.locator('#deep-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth>el.clientWidth+1||document.documentElement.scrollWidth>innerWidth}));assert.equal(geometry.overflow,false);assert.deepEqual(errors,[]);
  const result={repository,width,selected,outcome,reason,downloaded,elapsedMs:performance.now()-started,geometry,errors,tasks,requests,requestCount:requests.length,responseBytes:requests.reduce((n,r)=>n+r.bytes,0),text};results.push(result);await writeFile(prefix+'-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({repository,selected,outcome,reason,requestCount:result.requestCount,responseBytes:result.responseBytes}));
 }finally{await page.close();await preview.close();await app.cleanup();}
}await writeFile(out+'/results.json',JSON.stringify({cases:results},null,2));}finally{await browser.close();}
