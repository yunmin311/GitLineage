import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fixtureServer,A} from './fixture-server.ts';
import {relevanceFixture,purpose} from '../discovery/v4-fixture.ts';
import {createPreview,PREVIEW_PROFILE} from '../../experiments/discovery-v2/preview.ts';
import type {PreviewTask} from '../../experiments/discovery-v2/preview.ts';
import {validateReviewReceipt} from '../../experiments/discovery-v2/review-receipt.ts';
const out='artifacts/discovery-admission/chromium';await mkdir(out,{recursive:true});
const browser=await chromium.launch(),checks=[];
try{for(const [width,mode] of [[1920,'normal'],[1280,'normal'],[430,'normal'],[390,'normal'],[390,'none'],[390,'partial'],[390,'budget']] as const){
 const f=relevanceFixture();
 if(mode==='budget'){for(const i of [0,3])f.repos[i]!.files=Object.fromEntries(Array.from({length:8},(_,j)=>[`module${j}.js`,Buffer.from(`export function unique${j}(records) { return records.filter(item => item.enabled).map(item => item.label.trim()); }`)]));f.rebuild();}
 const preview=createPreview({enrichedSearch:true,cooldownMs:0,transport:async(url,init)=>{
  if(mode==='partial'&&url.includes(`/repos/${f.repos[3]!.name}/git/blobs/`))return new Response('{}',{status:404});
  const r=await f.transport(url,init),body=await r.json() as any,u=new URL(url);
  if(u.pathname==='/search/repositories'){
   const q=u.searchParams.get('q')!,supported=mode==='none'?{description:'Other purpose',language:'Solidity',topics:[]}:purpose;
   body.items=q.includes('in:name ')?[2,3].map(id=>({id,full_name:f.repos[id-1]!.name,html_url:`https://github.com/${f.repos[id-1]!.name}`,description:'Other purpose',topics:[]})):[4,5].map(id=>({id,full_name:id===4?f.repos[3]!.name:'other/fifth',html_url:`https://github.com/${id===4?f.repos[3]!.name:'other/fifth'}`,...supported}));body.total_count=body.items.length;
  }
  return new Response(JSON.stringify(body),{status:r.status});
 }}),app=await fixtureServer({previewHandler:preview.handler}),page=await browser.newPage({viewport:{width,height:932},reducedMotion:'reduce',isMobile:width<768,hasTouch:width<768}),tasks:PreviewTask[]=[],errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.request().method()==='GET'&&r.url().includes('/api/deep-search/tasks/')){const t=await r.json() as PreviewTask;if(t.state!=='running'&&!tasks.some(x=>x.id===t.id))tasks.push(t);}});
 try{
  await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();await page.waitForTimeout(350);
  const before=await page.locator('#canvas').evaluate(el=>({box:el.getAttribute('viewBox'),ctm:(el as unknown as SVGSVGElement).getScreenCTM()?.toString(),url:location.href}));
  await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();await page.getByText(/Admission considered 4 observed identities/).waitFor();
  const ids=await page.locator('#deep-candidates input').evaluateAll(es=>es.map(e=>(e as HTMLInputElement).value));
  if(mode==='none'){await page.getByText(/No sufficiently relevant candidates found/).waitFor();assert.equal(ids.length,3);await page.locator('#deep-candidates input').first().focus();await page.keyboard.press('Space');assert.ok(await page.locator('#deep-candidates input').first().isChecked());}
  else{
   assert.deepEqual(ids,['4','5','2']);await page.locator('#deep-candidates input[value="4"]').focus();await page.keyboard.press('Space');await page.locator('#deep-source-preview').click();await page.locator('#deep-recommendations').waitFor();
   if(mode==='budget'){const inputs=page.locator('#deep-files input:not(:disabled)');assert.equal(await inputs.count(),16);for(let i=0;i<16;i++)await inputs.nth(i).check();}
   await page.locator('#deep-compare').click();await page.locator('#deep-review-download').waitFor({timeout:35000});
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-review-download').click()]);const path=`${out}/${width}-${mode}-review.json`;await download.saveAs(path);const receipt=JSON.parse(await readFile(path,'utf8'));validateReviewReceipt(receipt.review,receipt.export);
   const compared=tasks.find(t=>t.kind==='compare')!;assert.ok(compared);assert.ok(compared.comparison!.content.usage.attempts<=24);assert.equal(compared.comparison!.content.verification,'pending');assert.equal(compared.comparison!.content.lineageClaim,'none');
   if(mode!=='normal')assert.equal(compared.state,'partial');else assert.ok(receipt.review.comparisons[0].completedPairs>0);
   if(mode==='budget')assert.equal(compared.comparison!.content.usage.attempts,24);
  }
  const geometry=await page.locator('#deep-dialog').evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth>el.clientWidth+1||document.documentElement.scrollWidth>innerWidth}));assert.ok(geometry.width<=width&&!geometry.overflow);
  await page.screenshot({path:`${out}/${width}-${mode}.png`,fullPage:true});
  const search=tasks.find(t=>t.kind==='search')!.search!.result!;assert.equal(search.admission.observations.length,4);assert.equal(search.usage.candidates,3);assert.equal(search.usage.searchAttempts,2);assert.deepEqual(search.budget,PREVIEW_PROFILE);
  await page.locator('#deep-back').click();assert.deepEqual(await page.locator('#canvas').evaluate(el=>({box:el.getAttribute('viewBox'),ctm:(el as unknown as SVGSVGElement).getScreenCTM()?.toString(),url:location.href})),before);assert.deepEqual(errors,[]);
  checks.push({width,mode,ids,geometry,errors,tasks});
 }finally{await page.close();await preview.close();await app.cleanup();}
}await writeFile(out+'/results.json',JSON.stringify({mode:'controlled faults, real production bundle/provider/worker',checks},null,2));}finally{await browser.close();}
