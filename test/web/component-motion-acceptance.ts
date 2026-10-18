import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, A } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';
const app=await fixtureServer({publicExploration:true,phaseDelayMs:0,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
const browser=await chromium.launch();
const out='artifacts/component-refinement';await mkdir(out,{recursive:true});
const geometry:unknown[]=[];
try {
 for(const width of [1920,1280,430,390]) {
  const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url+'/'+A);await page.locator('#workspace-history').waitFor();
  let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  await page.route('**/api/explore',async route=>{await gate;await route.fulfill({status:503,json:{error:'commit: response_bytes_exhausted'}});});
  await page.locator('#workspace-history').click();await page.locator('#git-history[aria-busy=true]').waitFor();
  await page.screenshot({path:`${out}/${width}-pending.png`});
  try {
   assert.equal(await page.locator('.history-pending-row').count(),6,'Pending History reserves readable log rows instead of a three-bar alert card');
   const motion=await page.locator('.history-pending-row').first().evaluate(n=>({x:getComputedStyle(n).opacity,animations:n.getAnimations({subtree:true}).map(a=>a.playState)}));
   assert.ok(motion.animations.includes('running'),'Pending log visibly animates while actual request is pending');
   if(width===1280){
    const row=page.locator('.history-pending-row').first();
    await row.evaluate(n=>{const a=n.getAnimations()[0]!;a.pause();a.currentTime=0;});
    const start=await row.evaluate(n=>getComputedStyle(n).opacity);
    await page.screenshot({path:`${out}/motion-waiting-start.png`});
    await row.evaluate(n=>{n.getAnimations()[0]!.currentTime=900;});
    const middle=await row.evaluate(n=>getComputedStyle(n).opacity);
    assert.notEqual(start,middle,'The pending indicator paints different visible frames');
    await page.screenshot({path:`${out}/motion-waiting-middle.png`});
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.history-pending-row').first().evaluate(n=>n.getAnimations({subtree:true}).length),0,'Reduced motion leaves a static readable log placeholder');
  } finally {release();}
  await page.locator('#history-retry').waitFor();
  const bounds=await page.locator('#git-history header').evaluate(n=>{const box=(e:Element)=>e.getBoundingClientRect().toJSON();return{heading:box(n.querySelector('.history-heading')!),back:box(n.querySelector('#history-return')!),stage:box(n)}});
  const h=bounds.heading,b=bounds.back;assert.ok(h.right<=b.left||b.right<=h.left||h.bottom<=b.top||b.bottom<=h.top,'History identity and return control never overlap');
  assert.ok(b.height>=44&&b.left>=0&&b.right<=width,'Return remains a visible touch target');
  geometry.push({width,...bounds});
  await page.screenshot({path:`${out}/${width}-failure.png`});
  assert.doesNotMatch(await page.locator('.history-load-message').innerText(),/response_bytes_exhausted/,'Machine failure codes do not replace the reading explanation');
  await page.locator('.history-error-details summary').click();
  assert.match(await page.locator('.history-error-details').innerText(),/response_bytes_exhausted/,'Exact failure remains available for diagnosis');
  const exits=page.locator('.history-load button').filter({hasText:'Return to graph'});await exits.click();
  assert.equal(await page.locator('#git-history').count(),0,'Every failure preserves an actionable graph return');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal document overflow');
  assert.deepEqual(errors,[],'No browser runtime errors');
  await page.close();
 }
 await writeFile(`${out}/history-geometry.json`,JSON.stringify(geometry,null,2));
 console.log('PASS log-shaped pending state, live/reduced motion, readable failure + exact technical reason, graph return at 1920/1280/430/390');
}finally{await browser.close();await app.cleanup();}
