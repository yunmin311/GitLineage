/** V3.3 audit closeout: rendered grouping, parameter feedback and selection continuity. Offline only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A,B} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const baseline=process.env.UI_CLOSEOUT_BASELINE==='1',out=`artifacts/design-closeout/${baseline?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch(),evidence:unknown[]=[];
try {for(const width of [1920,1280,430,390]) {
 const app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
 const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(app.url);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${out}/${width}-landing.png`});
  if(!baseline){
   assert.equal(await page.locator('[data-depth][aria-pressed=true]').count(),1,'One explicit analysis depth is selected');
   await page.locator('[data-depth="600"]').focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('[data-depth="600"]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-depth="200"]').getAttribute('aria-pressed'),'false');
   for(const b of await page.locator('[data-depth]').all())assert.ok((await b.boundingBox())!.height>=44);
   assert.equal(await page.locator('.seg').evaluate(n=>getComputedStyle(n).borderTopWidth),'0px','Parameters are not another framed navigation bar');
  }
  await page.locator('#landing').evaluate(n=>n.scrollTop=n.scrollHeight);await page.screenshot({path:`${out}/${width}-landing-lower.png`});
  // The guide is now a reading ledger beside an illustrative connection, rather than three peer cards.
  if(!baseline){const columns=await page.locator('.trust-cell').evaluateAll(ns=>ns.map(n=>({heading:n.querySelector('h3')!.getBoundingClientRect().left,body:n.querySelector('p')!.getBoundingClientRect().left})));for(const c of columns)assert.ok(Math.abs(c.heading-c.body)<1,'Each explanation shares its heading alignment');assert.match(await page.locator('.relationship-specimen figcaption').innerText(),/Illustration/,'The specimen is explicitly separate from analyzed results');}
  await page.route('**/api/analysis/'+B.toLowerCase(),r=>r.fulfill({status:202,json:{jobId:'closeout',status:'collecting',statusUrl:'/api/analysis/jobs/closeout',retryAfterMs:1500}}));
  await page.route('**/api/analysis/jobs/closeout',r=>r.fulfill({json:{jobId:'closeout',status:'collecting',repository:B}}));
  await page.goto(`${app.url}/${B}?tracer-test=1`);await page.locator('.an-plabel.is-now').waitFor();
  await page.screenshot({path:`${out}/${width}-analysis.png`});
  if(!baseline){
   assert.equal(await page.locator('#an-svg').count(),0,'No duplicate progress rules beneath the five stages');
   const boxes=await page.locator('.an-plabel .n').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().toJSON()));
   for(const b of boxes)assert.equal(b.width,b.height,'Stage markers stay circular at every viewport');
   await page.evaluate(()=>window.__setPhaseForTest?.('validating'));
   assert.equal(await page.locator('.an-plabel[aria-current=step]').count(),1);
  }
  await page.goto(app.url+'/'+A);await page.locator('#workspace-candidates').waitFor();
  if(width<768)await page.locator('[data-mobile-view=relations]').click();
  else if(await page.locator('#rail-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#rail-toggle').click();
  await page.locator('#workspace-candidates').click();await page.locator('#deep-repository').fill(A);await page.locator('#deep-search-submit').click();
  const choice=page.locator('#deep-candidates input').first();await choice.focus();
  const camera=await page.locator('#canvas').getAttribute('viewBox');
  const panelScroll=await choice.evaluate(n=>n.closest('#rail-scroll,#mobile-relation-list')?.scrollTop);
  await page.keyboard.press('Space');
  await page.screenshot({path:`${out}/${width}-candidate.png`});
  if(!baseline){
   assert.equal(await choice.evaluate(n=>document.activeElement===n),true,'Selection retains focus');
   assert.equal(await choice.evaluate(n=>n.closest('#rail-scroll,#mobile-relation-list')?.scrollTop),panelScroll,'Selection retains the reading position');
   assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera,'Choosing comparison scope preserves the graph camera');
   assert.equal(await page.locator('.deep-candidate.is-selected').count(),1,'Selection has a visible local surface');
   await page.emulateMedia({reducedMotion:'no-preference'});
   // The accepted site makes keyboard feedback immediate. Use a real pointer
   // click to transfer input ownership before testing the pointer transition.
   assert.equal(await choice.evaluate(n=>getComputedStyle(n.closest('.deep-candidate')!).transitionProperty),'none','Keyboard feedback remains immediate');
   await choice.click();
   const feedback=await choice.evaluate(input=>{
    const card=input.closest('.deep-candidate')!;getComputedStyle(card).backgroundColor;
    const transitions=card.getAnimations();transitions.forEach(a=>{a.pause();a.currentTime=0;});
    const first=getComputedStyle(card).backgroundColor;
    transitions.forEach(a=>a.currentTime=Number(a.effect!.getTiming().duration)/2);
    const middle=getComputedStyle(card).backgroundColor;transitions.forEach(a=>a.finish());
    return {count:transitions.length,first,middle};
   });
   assert.ok(feedback.count>0&&feedback.first!==feedback.middle,'Selection color has a real local transition');
   await page.emulateMedia({reducedMotion:'reduce'});await page.keyboard.press('Space');
   assert.equal(await choice.evaluate(n=>n.closest('.deep-candidate')!.getAnimations().length),0,'Reduced motion has immediate selection feedback');
  }
  await page.locator('#deep-source-preview').click();await page.locator('#deep-files input').first().waitFor();
  const scope=page.locator('#deep-scope');await scope.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-scope.png`});
  if(!baseline){
   assert.equal(await scope.locator('h4').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)),14,'Scope heading uses the accepted Relationship Map 14px role');
   assert.doesNotMatch(await scope.innerText(),/HTTP remaining|selected blob reads/,'Machine receipt does not obscure the next action');
   const detail=page.locator('#deep-scope-details');assert.equal(await detail.getAttribute('open'),null);
   await detail.locator('summary').click();assert.match(await detail.innerText(),/HTTP remaining/,'Exact budget remains readable');
   await detail.locator('summary').click();
   // V3 recommends multiple files; establish a manual single-file scope before testing keyboard addition.
   const choices=page.locator('.deep-file-card').first().locator('input:enabled');
   assert.equal(await choices.count(),2,'Fixture supplies two selectable files');
   const extra=choices.last();await extra.uncheck();
   assert.match(await scope.innerText(),/ID 1: 1 file\(s\)/,'Manual review can reduce the recommended scope');
   await extra.focus();await page.keyboard.press('Space');
   assert.match(await scope.innerText(),/ID 1: 2 file\(s\)/,'Scope updates with retained selections');
   assert.equal(await extra.evaluate(n=>document.activeElement===n),true,'Updating scope never steals checkbox focus');
  }
  const geometry=await page.locator('#rail').evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));evidence.push({width,geometry});
  assert.ok(geometry.scroll<=geometry.client+1);assert.deepEqual(errors,[]);console.log('PASS design closeout',width,baseline?'baseline':'verified');
 }finally{await page.close();await app.cleanup();}
}}finally{await browser.close();await writeFile(out+'/geometry.json',JSON.stringify(evidence,null,2));}
