/** Analysis stages stay spatially stable; no sliding panel or distorted SVG markers. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,B} from './fixture-server.ts';
const app=await fixtureServer({phaseDelayMs:0}),browser=await chromium.launch();
const out='artifacts/analysis-indicator';await mkdir(out,{recursive:true});const evidence:unknown[]=[];
try {for(const width of [375,390,430,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});
 try {
  await page.route('**/api/analysis/'+B.toLowerCase(),r=>r.fulfill({status:202,json:{jobId:'indicator-check',status:'collecting',statusUrl:'/api/analysis/jobs/indicator-check',retryAfterMs:1500}}));
  await page.route('**/api/analysis/jobs/indicator-check',r=>r.fulfill({json:{jobId:'indicator-check',status:'collecting',repository:B}}));
  await page.goto(app.url+'/'+B+'?tracer-test=1');await page.locator('.an-plabel.is-now').waitFor();await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const before=await page.locator('.an-plabel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),parent=n.closest('.an-path')!.getBoundingClientRect();return{x:r.x,y:r.y-parent.y,width:r.width,height:r.height};}));
  await page.screenshot({path:`${out}/${width}-before.png`});
  const current=page.locator('.an-plabel.is-now');
  assert.equal(await current.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)','Active phase must not become a travelling blue panel');
  assert.equal(await current.getAttribute('aria-current'),'step','Current phase is explicit without relying on color');
  assert.equal(await current.evaluate(n=>n.getAnimations().length),0,'The phase label never translates on arrival');
  assert.equal(await page.locator('#an-svg').count(),0,'No duplicate SVG progress beneath the HTML stage markers');
  const dot=current.locator('.n');
  const motion=await dot.evaluate(n=>{const a=n.getAnimations()[0]!;if(!a)return null;a.pause();a.currentTime=0;const start=getComputedStyle(n).opacity;a.currentTime=900;return{start,end:getComputedStyle(n).opacity,transform:getComputedStyle(n).transform};});
  assert.ok(motion&&motion.start!==motion.end,'Only the current stage marker gently changes opacity');assert.equal(motion.transform,'none');
  await page.evaluate(()=>window.__setPhaseForTest?.('validating'));
  const after=await page.locator('.an-plabel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),parent=n.closest('.an-path')!.getBoundingClientRect();return{x:r.x,y:r.y-parent.y,width:r.width,height:r.height};}));
  assert.deepEqual(after,before,'Stage advancement leaves each label in its fixed slot, independent of the phase description height');
  assert.equal(await page.locator('.an-plabel[aria-current=step]').count(),1);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.an-plabel.is-now .n').evaluate(n=>n.getAnimations().length),0,'Reduced motion presents a static current marker');
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});
  await page.screenshot({path:`${out}/${width}-after.png`});evidence.push({width,before,after,motion});
  console.log('PASS fixed analysis indicators',width);
 }finally{await page.close();}
}}finally{await browser.close();await app.cleanup();await writeFile(out+'/geometry.json',JSON.stringify(evidence,null,2));}
