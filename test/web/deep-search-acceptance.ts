import {chromium} from 'playwright';
import {cacheProof} from './cache-proof.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {fixtureServer,A} from './fixture-server.ts';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {officialFixture} from '../../experiments/discovery-v2/phase1d-mock.ts';
const fixture=officialFixture();
// A constructed Fork can diverge while an unknown candidate remains identical.
fixture.repos[1]!.files['index.js']=Buffer.from('export const answer = 12345;\n');fixture.rebuild();
let preview:ReturnType<typeof createPreview>,app:Awaited<ReturnType<typeof fixtureServer>>;
const browser=await chromium.launch(),out=resolve('artifacts/deep-search');await mkdir(out,{recursive:true});
const checks:unknown[]=[];
try{
 app=await fixtureServer();const anonymous=await browser.newPage();await anonymous.goto(app.url);assert.equal(await anonymous.locator('#deep-launch').count(),0);await anonymous.close();await app.cleanup();
 for(const width of [390,430,1280,1920]){
 preview=createPreview({transport:fixture.transport,cooldownMs:0});app=await fixtureServer({previewHandler:preview.handler});
 const page=await browser.newPage({viewport:{width,height:width<768?932:1080},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+preview.accessPath);await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();await page.locator('#canvas .node-hit').first().click();await page.waitForTimeout(150);
 const graphState=await page.locator('#canvas').evaluate(el=>({ctm:JSON.stringify((el as unknown as SVGSVGElement).getScreenCTM()),selection:new URL(location.href).searchParams.get('node')}));
 const cacheBefore=await cacheProof(app.fixtureCacheRoot);
 const camera=await page.locator('#canvas').getAttribute('viewBox'),url=page.url();
 await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();
 await page.locator('#deep-candidates input').first().waitFor();assert.equal(await page.locator('#deep-candidates input').count(),3);
 await page.locator('#deep-candidates input').nth(0).check();await page.locator('#deep-candidates input').nth(2).check();await page.locator('#deep-compare').click();
 await page.locator('#deep-results .deep-measurement').first().waitFor();await page.getByText('Verification: pending · Lineage claim: none',{exact:true}).last().waitFor();
 assert.match(await page.locator('#deep-results').innerText(),/normalized_token5/);assert.match(await page.locator('#deep-results').innerText(),/Unknown/);assert.match(await page.locator('.deep-result').first().innerText(),/0\.00%/);assert.match(await page.locator('.deep-result').last().innerText(),/100\.00%/);
 const geometry=await page.locator('#deep-dialog').evaluate(el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
 assert.ok(geometry.x>=0&&geometry.width<=width&&!geometry.overflow);
 const textMetrics=await page.locator('#deep-results').evaluate(el=>({font:parseFloat(getComputedStyle(el.querySelector('p')!).fontSize),button:document.querySelector('#deep-back')!.getBoundingClientRect().height}));assert.ok(textMetrics.font>=10&&textMetrics.button>=44);
 if(width<768){const cdp=await page.context().newCDPSession(page);const touch=(y:number)=>[{x:width/2,y,id:1}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touch(760)});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touch(500)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(100);assert.ok(await page.locator('#deep-dialog').evaluate(el=>el.scrollTop)>0);assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera);await cdp.detach();}
 const raw=page.getByText('Raw measurement, matched token ranges and fingerprints',{exact:true}).first();await raw.click();assert.ok((await raw.locator('..').innerText()).includes('firstDigest'));
 const paths=page.getByText('Pinned snapshots, Git blob SHA, file bindings and incomplete paths',{exact:true}).first();await paths.click();assert.match(await paths.locator('..').innerText(),/selected path unavailable/);
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-download').click()]);assert.equal(download.suggestedFilename(),'gitlineage-deep-sidecar.json');await download.saveAs(resolve(out,`${width}-mock-sidecar.json`));
 await page.locator('#deep-dialog').evaluate(el=>el.scrollTo(0,0));
 await page.screenshot({path:resolve(out,`${width}-comparison.png`),fullPage:true});
 await page.locator('#deep-back').click();assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera);assert.equal(page.url(),url);assert.equal(await page.locator('#deep-launch').evaluate(el=>el===document.activeElement),true);assert.deepEqual(errors,[]);assert.deepEqual(await page.locator('#canvas').evaluate(el=>({ctm:JSON.stringify((el as unknown as SVGSVGElement).getScreenCTM()),selection:new URL(location.href).searchParams.get('node')})),graphState);
 assert.deepEqual(await cacheProof(app.fixtureCacheRoot),cacheBefore);
 checks.push({cacheUnchanged:true,width,status:'PASS',geometry,graphCameraPreserved:true,graphURLPreserved:true,errors});await page.close();
 // Preview global frequency ledger is intentionally not bypassed in browsers.
 await preview.close();await app.cleanup();app=undefined as never;
 }
 for(const mode of ['rate_limit','cancel'] as const){
 preview=createPreview({cooldownMs:0,transport:async(_url,init)=>{if(mode==='rate_limit')return new Response('',{status:403,headers:{'x-ratelimit-remaining':'0'}});await new Promise<void>((_r,j)=>init.signal.addEventListener('abort',()=>j(new Error('cancelled')),{once:true}));throw new Error('cancelled');}});app=await fixtureServer({previewHandler:preview.handler});
 const page=await browser.newPage();await page.goto(app.url+preview.accessPath);await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();
 if(mode==='cancel'){await page.locator('#deep-cancel').click();await page.waitForFunction(()=>document.querySelector('#deep-status')?.textContent?.includes('cancelled'));}else await page.waitForFunction(()=>document.querySelector('#deep-status')?.textContent?.includes('partial'));
 assert.match(await page.locator('#deep-candidates').innerText(),/incomplete or unavailable/);assert.equal(await page.locator('#deep-results .deep-measurement').count(),0);
 await page.screenshot({path:resolve(out,`${mode}.png`)});checks.push({mode,status:'PASS',unavailableNotZero:true});await page.close();await preview.close();await app.cleanup();app=undefined as never;
 }
 await writeFile(resolve(out,'validation.json'),JSON.stringify({checks,transport:'official fixed Mock, not live GitHub',calls:fixture.calls},null,2));
}finally{await preview!.close();await browser.close();if(app!)await app.cleanup();}
