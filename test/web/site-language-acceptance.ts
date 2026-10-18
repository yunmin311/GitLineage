/** Presentation regressions: actual painted step labels, disclosure and Discovery reset.
 * GitHub transport is fixed offline data; analysis job responses below use a held clock.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, A, B, D } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';
const app=await fixtureServer({publicExploration:true,phaseDelayMs:0,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
const browser=await chromium.launch();const out='artifacts/site-language';await mkdir(out,{recursive:true});const measurements:unknown[]=[];
async function settleUI(page:import('playwright').Page) {
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().endTime!==Infinity).map(a=>a.finished.catch(()=>{})));});
}
async function progressInk(page:import('playwright').Page) {
 const box=await page.locator('.an-seg.is-now').boundingBox();assert.ok(box);
 const png=await page.screenshot({clip:{x:box.x+4,y:box.y-2,width:box.width-8,height:4}});
 const decoder=await browser.newPage();
 try{return await decoder.evaluate(async data=>{
  const img=new Image();img.src=`data:image/png;base64,${data}`;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
  const pixels=ctx.getImageData(0,0,img.width,img.height).data;let ink=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i]!<150&&pixels[i+2]!>pixels[i]!+8)ink++;
  return ink;
 },png.toString('base64'));}finally{await decoder.close();}
}
try {
 for(const width of [1920,1280,430,390]) {
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/analysis/'+B.toLowerCase(),route=>route.fulfill({status:202,json:{jobId:'language-check',status:'collecting',statusUrl:'/api/analysis/jobs/language-check',retryAfterMs:1500}}));
  await page.route('**/api/analysis/jobs/language-check',route=>route.fulfill({json:{jobId:'language-check',status:'collecting',repository:B}}));
  await page.goto(`${app.url}/${B}?tracer-test=1`);await page.locator('#analysis:not([hidden]) .an-plabel').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  const steps=await page.locator('.an-path').evaluate(n=>{
   const labels=[...n.querySelectorAll('.an-plabel')];const bar=n.querySelector('svg')!.getBoundingClientRect();
   return {bar:bar.toJSON(),labels:labels.map(e=>{const name=e.querySelector(innerWidth<768?'.t-short':'.t')!;const ordinal=e.querySelector('.n')!;return {box:e.getBoundingClientRect().toJSON(),name:name.textContent,nameDisplay:getComputedStyle(name).display,ordinal:getComputedStyle(ordinal).display};})};
  });
  assert.equal(steps.labels.length,5);
  for(const step of steps.labels){assert.notEqual(step.ordinal,'none');assert.notEqual(step.nameDisplay,'none');assert.ok(step.name);assert.ok(steps.bar.bottom<=step.box.bottom+1&&steps.bar.top>=step.box.top,'Progress line belongs inside the stage labels');assert.ok(step.box.left>=0&&step.box.right<=width);}
  assert.equal(await page.evaluate(()=>{const before=document.querySelector('.an-plabel.is-now');window.__setPhaseForTest?.('collecting');return before===document.querySelector('.an-plabel.is-now');}),true,'An unchanged poll retains labels and does not restart their animation');
  const motion=await page.evaluate(()=>{window.__setPhaseForTest?.('validating');const node=document.querySelector('.an-obj')!;const a=node.getAnimations()[0]!;a.pause();a.currentTime=0;const start=getComputedStyle(node).opacity;a.currentTime=260;return{start,end:getComputedStyle(node).opacity};});
  assert.notEqual(motion.start,motion.end,'A phase change paints distinct frames');
  await page.waitForTimeout(280);assert.ok(await progressInk(page)>4,'The active progress line paints above its stage background');await page.screenshot({path:`${out}/${width}-analysis.png`});
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__setPhaseForTest?.('publishing'));
  assert.equal(await page.locator('.an-plabel.is-now').evaluate(n=>n.getAnimations().length),0,'Reduced motion keeps current step readable without animation');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(`${app.url}/${D}`);await page.locator('#workspace-history').waitFor();
  await page.waitForFunction(()=>{
   const svg=document.querySelector('#canvas');const hit=svg?.querySelector('.node.is-subject .node-hit')?.getBoundingClientRect();
   if(!svg||!hit)return false;
   const box=svg.getAttribute('viewBox')+JSON.stringify(hit.toJSON());
   const w=window as typeof window & {languageCamera?:{box:string|null|undefined,since:number}};
   if(!w.languageCamera||w.languageCamera.box!==box){w.languageCamera={box,since:performance.now()};return false;}
   return !!box&&performance.now()-w.languageCamera.since>=300;
  });
  const subject=page.locator('svg .node.is-subject .node-hit');
  if(width<768)await subject.tap();else await subject.click();
  await page.waitForURL(url=>url.searchParams.has('node'));
  if(width<768)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
  const headings=page.locator('#drawer-inner .d-group-head');

  await headings.first().waitFor();
  assert.doesNotMatch((await headings.allTextContents()).join('\n'),/no manifest|forked_from|shares_history_with/,'Absence of a manifest is not a relationship name');
  assert.ok((await headings.allTextContents()).some(t=>t.includes('References')));
  await page.locator('#drawer').evaluate(async n=>{await Promise.all(n.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
  await settleUI(page);await page.screenshot({path:`${out}/${width}-inspector.png`});
  // Interruption leaves the native disclosure, focus and real hit target coherent.
  const head=headings.first();const expanded=(await head.locator('..').boundingBox())!.height;
  await head.click();
  const disclosure=await head.locator('..').evaluate(n=>{
   // Advance a real CSS transition to a known frame; no screenshot timing assumption.
   getComputedStyle(n,'::details-content').blockSize;
   const animation=n.getAnimations({subtree:true}).find(a=>a instanceof CSSTransition&&a.transitionProperty==='block-size');
   if(!animation)return null;animation.pause();animation.currentTime=110;
   const middle=n.getBoundingClientRect().height;animation.finish();return middle;
  });
  if(disclosure!==null)assert.ok(disclosure>(await head.boundingBox())!.height&&disclosure<expanded,'Disclosure paints an intermediate height');
  await head.click();await head.click();
  await page.waitForTimeout(260);assert.equal(await head.evaluate(n=>(n.parentElement as HTMLDetailsElement).open),false);
  assert.equal(await head.evaluate(n=>document.activeElement===n),true);
  assert.ok((await head.boundingBox())!.height>=44);
  if(width<768)await page.locator('[data-mobile-view=relations]').click();else if(!await page.locator('#rail').isVisible())await page.locator('#rail-toggle').click();
  await page.locator('#workspace-candidates').click();
  const ready=await page.locator('#deep-status').evaluate(n=>({text:n.textContent,state:(n as HTMLElement).dataset.state,left:getComputedStyle(n).borderLeftWidth}));
  assert.equal(ready.state,'ready');assert.equal(ready.text,'Ready to search · no request made.');assert.equal(ready.left,'1px','Status has a complete enclosing border, not a leftover blue stripe');
  await page.locator('#deep-status').evaluate(async n=>{await Promise.all(n.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
  await settleUI(page);await page.screenshot({path:`${out}/${width}-discovery-ready.png`});
  await page.locator('#deep-repository').fill(A);await page.locator('#deep-search-submit').click();
  await page.locator('#deep-status[data-state=completed],#deep-status[data-state=partial]').waitFor();
  const state=await page.locator('#deep-status').getAttribute('data-state');assert.equal(state,'completed');await page.locator('#deep-candidates input').first().waitFor();
  await page.locator('#deep-candidates').evaluate(async n=>{await Promise.all(n.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
  await page.locator('#deep-candidates input').first().scrollIntoViewIfNeeded();
  const choices=await page.locator('.deep-candidate label').evaluateAll(nodes=>nodes.map(n=>{const input=n.querySelector('input')!.getBoundingClientRect();const text=n.querySelector('span')!.getBoundingClientRect();return {input:input.toJSON(),text:text.toJSON(),label:n.getBoundingClientRect().toJSON()};}));
  for(const choice of choices){assert.equal(choice.input.width,24,'Candidate checkbox keeps its own width instead of inheriting the search field width');assert.equal(choice.input.height,24);assert.ok(choice.text.width>=choice.label.width-40,'Repository name receives the available row width');assert.ok(choice.label.height>=44,'The complete label remains a touch target');}
  await settleUI(page);await page.screenshot({path:`${out}/${width}-discovery-results.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  measurements.push({width,steps,ready,state,errors});await page.close();
 }
 await writeFile(`${out}/geometry.json`,JSON.stringify(measurements,null,2));console.log('PASS integrated stage labels, stable polls, painted/reduced motion, readable relationship groups, disclosure interruption, Discovery reset/results at 1920/1280/430/390');
} finally {await browser.close();await app.cleanup();}
