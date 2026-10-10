import {chromium} from 'playwright';
import {cacheProof} from './cache-proof.ts';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {fixtureServer,A} from './fixture-server.ts';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
import {validatePreviewExport,validateSourceExport} from '../../experiments/discovery-v2/preview-contract.ts';
const fixture=treeFixture();
// A constructed Fork can diverge while an unknown candidate remains identical.
fixture.repos[0]!.files={'src/main.ts':fixture.repos[0]!.files['index.js']!, 'src/extra.ts':Buffer.from('export const extra = 234567;\n')};
fixture.repos[1]!.files={'lib/core.ts':Buffer.from('export const answer = 12345;\n')};
fixture.repos[3]!.files={'lib/core.ts':fixture.repos[0]!.files['src/main.ts']!};fixture.rebuild();
let preview:ReturnType<typeof createPreview>,app:Awaited<ReturnType<typeof fixtureServer>>;
const browser=await chromium.launch(),out=resolve('artifacts/deep-search');await mkdir(out,{recursive:true});
const checks:unknown[]=[];
try{
 app=await fixtureServer();const anonymous=await browser.newPage();await anonymous.goto(app.url);assert.equal(await anonymous.locator('#deep-launch').count(),0);await anonymous.close();await app.cleanup();
 for(const width of [390,430,1280,1920]){
 preview=createPreview({transport:fixture.transport,cooldownMs:0});app=await fixtureServer({previewHandler:preview.handler});
 const page=await browser.newPage({viewport:{width,height:width<768?932:1080},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();await page.locator('#canvas .node-hit').first().click();await page.waitForTimeout(150);
 const graphState=await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,selection:new URL(location.href).searchParams.get('node')}});assert.ok(graphState.ctm&&graphState.ctm.some(Number.isFinite));assert.notDeepEqual(graphState.ctm.slice(0,4),[0,0,0,0]);
 const cacheBefore=await cacheProof(app.fixtureCacheRoot);
 const camera=await page.locator('#canvas').getAttribute('viewBox'),url=page.url();
 await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();
 await page.locator('#deep-candidates input').first().waitFor();assert.equal(await page.locator('#deep-candidates input').count(),3);
 await page.locator('#deep-candidates input').nth(0).check();await page.locator('#deep-candidates input').nth(2).check();await page.locator('#deep-source-preview').click({timeout:2000});
 await page.locator('#deep-files input').first().waitFor();
 assert.equal(await page.locator('#deep-files input[value="src/main.ts"]').count(),1);
 await page.locator('#deep-files input[value="src/main.ts"]').check();await page.locator('#deep-files input[value="src/extra.ts"]').check();await page.locator('#deep-files input[value="src/extra.ts"]').uncheck();
 assert.match(await page.locator('#deep-scope').innerText(),/src\/main.ts/);
 const [listingDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-source-download').click()]);const listingPath=resolve(out,`${width}-source-sidecar.json`);await listingDownload.saveAs(listingPath);const listingReceipt=JSON.parse(await readFile(listingPath,'utf8'));validateSourceExport(listingReceipt);
 const callsBeforeRejection=fixture.calls.length;const rejected=await page.request.post(app.url+'/api/deep-search/compare',{headers:{origin:app.url},data:{searchId:listingReceipt.searchTaskId,candidateIds:[4],selection:{sourceTaskId:listingReceipt.sourceTaskId,files:[{repositoryId:1,paths:['src/main.ts']},{repositoryId:4,paths:['lib/core.ts']}]}}});assert.equal(rejected.status(),400);assert.equal(fixture.calls.length,callsBeforeRejection);
 await page.screenshot({path:resolve(out,`${width}-source-selection.png`),fullPage:true});
 await page.locator('#deep-back').click();await page.locator('#deep-candidate-layer').click();
 assert.match(await page.locator('#deep-layer-dialog').innerText(),/Not compared — no score/);
 await page.locator('#deep-layer-dialog .deep-layer-candidate').last().click();
 assert.match(await page.locator('#deep-inspection').innerText(),/No valid pinned comparison measurement/);
 await page.locator('#deep-compare').click();
 await page.locator('#deep-results .deep-measurement').first().waitFor({timeout:5000}).catch(async error=>{console.error(await page.locator('#deep-dialog').innerText());throw error;});await page.getByText('Verification: pending · Lineage claim: none',{exact:true}).last().waitFor();
 assert.match(await page.locator('#deep-results').innerText(),/normalized_token5/);assert.match(await page.locator('#deep-results').innerText(),/Unknown/);assert.match(await page.locator('.deep-result').first().innerText(),/0\.00%/);assert.match(await page.locator('.deep-result').last().innerText(),/100\.00%/);
 const geometry=await page.locator('#deep-dialog').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.ok(geometry.x>=0&&geometry.width<=width&&!geometry.overflow);
 const textMetrics=await page.locator('#deep-results').evaluate(el=>({font:parseFloat(getComputedStyle(el.querySelector('p')!).fontSize),button:document.querySelector('#deep-back')!.getBoundingClientRect().height}));assert.ok(textMetrics.font>=10&&textMetrics.button>=44);
 if(width<768){const cdp=await page.context().newCDPSession(page);const touch=(y:number)=>[{x:width/2,y,id:1}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(760)});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(500)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);assert.ok(await page.locator('#deep-dialog').evaluate(el=>el.scrollTop)>0);assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera);await cdp.detach();}
 const raw=page.getByText('Raw measurement, matched token ranges and fingerprints',{exact:true}).first();await raw.click();assert.ok((await raw.locator('..').innerText()).includes('firstDigest'));
 const paths=page.getByText('Pinned snapshots, Git blob SHA, file bindings and incomplete paths',{exact:true}).first();await paths.click();assert.match(await paths.locator('..').innerText(),/explicit selected paths only/); // Entry-path failures are no longer manufactured by tree-derived selection.
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-download').click()]);assert.equal(download.suggestedFilename(),'gitlineage-deep-sidecar.json');const saved=resolve(out,`${width}-mock-sidecar.json`);await download.saveAs(saved);const exported=JSON.parse(await readFile(saved,'utf8'));validatePreviewExport(exported);assert.equal(exported.schemaVersion,'discovery-preview-export@2');assert.equal(exported.provenance.candidates.length,2);for(const candidate of exported.provenance.candidates){assert.equal(candidate.repositoryId,candidate.searchCandidate.candidate.repositoryId);for(const d of candidate.searchCandidate.discoveries){assert.equal(d.query,'example in:name is:public fork:true');assert.ok(d.rank>0&&d.page===1&&d.reason);}}assert.equal(exported.selection!.combined.usage.attempts,fixture.calls.length);fixture.calls.length=0;
 await page.locator('#deep-dialog').evaluate(el=>el.scrollTo(0,0));
 await page.screenshot({path:resolve(out,`${width}-comparison.png`),fullPage:true});
 await page.locator('#deep-back').click();assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera);assert.equal(page.url(),url);assert.equal(await page.locator('#deep-launch').evaluate(el=>el===document.activeElement),true);assert.deepEqual(errors,[]);assert.deepEqual(await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,selection:new URL(location.href).searchParams.get('node')}}),graphState);
 await page.locator('#deep-candidate-layer').click();
 await page.locator('#deep-layer-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#deep-layer-dialog .deep-layer-candidate').count(),3);
 assert.match(await page.locator('#deep-layer-dialog').innerText(),/Search observations.*Canonical/s);
 await page.screenshot({path:resolve(out,`${width}-candidate-layer.png`),fullPage:true});
 await page.locator('#deep-layer-dialog .deep-layer-candidate').last().click();
 await page.locator('#deep-dialog').waitFor({state:'visible'});
 assert.match(await page.locator('#deep-inspection').innerText(),/Bounded pinned source listing/);
 assert.match(await page.locator('#deep-results').innerText(),/Original search provenance/);
 await page.locator('#deep-back').click();
 assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera);assert.equal(page.url(),url);
 const graphAfter=await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,selection:new URL(location.href).searchParams.get('node')}});assert.deepEqual(graphAfter,graphState);
 const cacheAfter=await cacheProof(app.fixtureCacheRoot);assert.deepEqual(cacheAfter,cacheBefore);
 checks.push({cacheUnchanged:true,width,status:'PASS',geometry,graphCameraPreserved:true,graphURLPreserved:true,graphBefore:{viewBox:camera,url,...graphState},graphAfter:{viewBox:await page.locator('#canvas').getAttribute('viewBox'),url:page.url(),...graphAfter},cacheBefore,cacheAfter,errors});await page.close();
 // Preview global frequency ledger is intentionally not bypassed in browsers.
 await preview.close();await app.cleanup();app=undefined as never;
 }
 // A duplicate observation of one ID at two ranks must survive the entire HTTP/browser/download path.
 preview=createPreview({cooldownMs:0,transport:async(url,init)=>{
  const response=await fixture.transport(url,init);
  if(new URL(url).pathname==='/search/repositories'){
   const body=await response.json() as {items:unknown[];total_count:number};
   body.items=[body.items[2],body.items[2],body.items[0]];body.total_count=3;
   return new Response(JSON.stringify(body));
  }return response;
 }});app=await fixtureServer({previewHandler:preview.handler});
 const provenancePage=await browser.newPage();await provenancePage.goto(app.url+preview.accessPath);
 await provenancePage.locator('#deep-launch').click();await provenancePage.locator('#deep-repository').fill('root/example');await provenancePage.locator('#deep-search-submit').click();
 await provenancePage.locator('#deep-candidates input[value="4"]').check();await provenancePage.locator('#deep-source-preview').click();
 await provenancePage.locator('#deep-files input[value="src/main.ts"]').check();await provenancePage.locator('#deep-files input[value="src/extra.ts"]').uncheck();
 await provenancePage.locator('#deep-compare').click();await provenancePage.locator('#deep-download').waitFor();
 const [provenanceDownload]=await Promise.all([provenancePage.waitForEvent('download'),provenancePage.locator('#deep-download').click()]);
 const provenancePath=resolve(out,'multiple-search-observations-sidecar.json');await provenanceDownload.saveAs(provenancePath);
 const provenanceExport=JSON.parse(await readFile(provenancePath,'utf8'));validatePreviewExport(provenanceExport);
 assert.deepEqual(provenanceExport.provenance.candidates[0]!.searchCandidate.discoveries.map((d:{rank:number})=>d.rank),[1,2]);
 assert.equal(provenanceExport.probe.content.comparisons[0]!.candidate!.discoveries.length,2);
 assert.equal(provenanceExport.provenance.candidates[0]!.repositoryId,4);
 assert.equal(provenanceExport.probe.content.verification,'pending');assert.equal(provenanceExport.probe.content.lineageClaim,'none');
 checks.push({mode:'multiple-search-observations-downloaded-and-revalidated',status:'PASS',ranks:[1,2]});
 await provenancePage.close();await preview.close();await app.cleanup();app=undefined as never;
 for(const width of [390,430,1280,1920])for(const mode of ['filtered_only','no_results'] as const){
 const f=treeFixture();f.repos[3]!.files={'README.md':Buffer.from('Documentation only, no executable source')};f.rebuild();
 preview=createPreview({cooldownMs:0,transport:async(url,init)=>{const response=await f.transport(url,init);if(mode==='no_results'&&new URL(url).pathname==='/search/repositories')return new Response(JSON.stringify({items:[],total_count:0,incomplete_results:false}));return response;}});
 app=await fixtureServer({previewHandler:preview.handler});const page=await browser.newPage({viewport:{width,height:932}});await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();const original=await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{viewBox:el.getAttribute('viewBox'),ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,url:location.href,selection:new URL(location.href).searchParams.get('node')}});assert.ok(original.ctm&&original.ctm.some(Number.isFinite));const cache=await cacheProof(app.fixtureCacheRoot);await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();
 await page.waitForFunction(()=>/^search: (completed|partial)/.test(document.querySelector('#deep-status')?.textContent??''));
 if(mode==='filtered_only'){
  await page.locator('#deep-candidates input[value="4"]').check();await page.locator('#deep-source-preview').click();await page.locator('#deep-source-download').waitFor();
  assert.match(await page.locator('#deep-status').innerText(),/partial/);assert.match(await page.locator('#deep-files').innerText(),/Directory enumeration: complete · selectable sources: 0/);assert.equal(await page.locator('#deep-compare').isDisabled(),true);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-source-download').click()]);const path=resolve(out,'filtered-only-source-sidecar.json');await download.saveAs(path);const receipt=JSON.parse(await readFile(path,'utf8'));validateSourceExport(receipt);assert.equal(receipt.sources.repositories[1]!.coverage.enumeration,'complete');assert.equal(receipt.sources.repositories[1]!.coverage.eligibleFiles,0);
 }
 await page.locator('#deep-back').click();await page.locator('#deep-candidate-layer').click();assert.equal(await page.locator('#deep-layer-dialog .deep-layer-candidate').count(),mode==='no_results'?0:3);assert.equal(await page.locator('#deep-layer-dialog').getByText('0.00%').count(),0);await page.locator('#deep-layer-close').click();assert.deepEqual(await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{viewBox:el.getAttribute('viewBox'),ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,url:location.href,selection:new URL(location.href).searchParams.get('node')}}),original);assert.deepEqual(await cacheProof(app.fixtureCacheRoot),cache);
 checks.push({mode,width,status:'PASS',sourceReceiptDownloaded:mode==='filtered_only'});await page.close();await preview.close();await app.cleanup();app=undefined as never;
 }
 for(const width of [390,430,1280,1920])for(const mode of ['rate_limit','cancel'] as const){
 preview=createPreview({cooldownMs:0,transport:async(_url,init)=>{if(mode==='rate_limit')return new Response('',{status:403,headers:{'x-ratelimit-remaining':'0'}});await new Promise<void>((_r,j)=>init.signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true}));throw new Error('cancelled');}});app=await fixtureServer({previewHandler:preview.handler});
 const page=await browser.newPage({viewport:{width,height:932}});await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();const original=await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{viewBox:el.getAttribute('viewBox'),ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,url:location.href,selection:new URL(location.href).searchParams.get('node')}});assert.ok(original.ctm&&original.ctm.some(Number.isFinite));const cache=await cacheProof(app.fixtureCacheRoot);await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();
 if(mode==='cancel'){await page.locator('#deep-cancel').click();await page.waitForFunction(()=>document.querySelector('#deep-status')?.textContent?.includes('cancelled'));}else await page.waitForFunction(()=>document.querySelector('#deep-status')?.textContent?.includes('partial'));
 assert.match(await page.locator('#deep-candidates').innerText(),/incomplete or unavailable/);assert.equal(await page.locator('#deep-results .deep-measurement').count(),0);
 await page.screenshot({path:resolve(out,`${mode}.png`)});checks.push({mode,width,status:'PASS',unavailableNotZero:true});await page.locator('#deep-back').click();await page.locator('#deep-candidate-layer').click();assert.equal(await page.locator('#deep-layer-dialog .deep-layer-candidate').count(),0);await page.locator('#deep-layer-close').click();assert.deepEqual(await page.locator('#canvas').evaluate(el=>{const m=(el as unknown as SVGSVGElement).getScreenCTM();return{viewBox:el.getAttribute('viewBox'),ctm:m?[m.a,m.b,m.c,m.d,m.e,m.f].map(v=>Number(v.toFixed(4))):null,url:location.href,selection:new URL(location.href).searchParams.get('node')}}),original);assert.deepEqual(await cacheProof(app.fixtureCacheRoot),cache);await page.close();await preview.close();await app.cleanup();app=undefined as never;
 }
 await writeFile(resolve(out,'validation.json'),JSON.stringify({checks,transport:'official fixed Mock, not live GitHub',calls:fixture.calls},null,2));
}finally{await preview!.close();await browser.close();if(app!)await app.cleanup();}
