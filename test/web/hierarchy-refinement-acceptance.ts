/** Focused reading order and source selection regression; offline transport only. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, A, B } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';
const browser=await chromium.launch();
await mkdir('artifacts/hierarchy-first',{recursive:true});
try {
 for(const width of [1280,430,390,375]) {
  // Each viewport is an independent visitor session with its own unchanged admission limits.
  const f=unifiedFixture();
  const app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:f.transport});
  try {
  const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
  await page.goto(app.url);await page.evaluate(()=>document.fonts.ready);
  const form=await page.locator('#form').boundingBox();
  const legend=await page.locator('.sub-row:not(.sub-row-depth)').boundingBox();
  assert.ok(form&&legend&&legend.y>=form.y+form.height,'Evidence explanation follows the action form instead of competing inside it');
  for(const button of await page.locator('[data-depth]').all()) {
   const b=await button.boundingBox();assert.ok(b&&b.height>=44,'Analysis parameters retain touch targets');
  }
  await page.locator('[data-depth="600"]').click();assert.match(await page.locator('[data-depth="600"]').getAttribute('class')??'',/is-active/);
  await page.screenshot({path:`artifacts/hierarchy-first/${width}-landing.png`});
  await page.locator('#landing').evaluate(n=>n.scrollTop=n.scrollHeight);
  await page.screenshot({path:`artifacts/hierarchy-first/${width}-landing-lower.png`});
  // Hold an offline job so terminal styling can be measured without a live poll racing it.
  await page.route('**/api/analysis/'+B.toLowerCase(),r=>r.fulfill({status:202,json:{jobId:'hierarchy-held',status:'collecting',statusUrl:'/api/analysis/jobs/hierarchy-held',retryAfterMs:1500}}));
  await page.route('**/api/analysis/jobs/hierarchy-held',r=>r.fulfill({json:{jobId:'hierarchy-held',status:'collecting',repository:B}}));
  await page.goto(`${app.url}/${B}?tracer-test=1`);await page.locator('.an-plabel').first().waitFor();
  await page.evaluate("window.__setPhaseForTest('failed')");
  const inset=await page.locator('#an-verb').evaluate(n=>{const box=n.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(n);const text=range.getBoundingClientRect();return{left:text.left-box.left,top:text.top-box.top};});
  assert.ok(inset.left>=12&&inset.top>=12,'Failure explanation has readable space within its warning surface');
  await page.screenshot({path:`artifacts/hierarchy-first/${width}-analysis-failed.png`});
  await page.goto(app.url+'/'+A);await page.locator('#canvas .node-hit').first().waitFor();
  if(width<768)await page.locator('[data-mobile-view=relations]').click();
  else if(await page.locator('#rail-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#rail-toggle').click();
  await page.locator('#workspace-candidates').click();await page.locator('#deep-repository').fill(A);
  await page.locator('#deep-search-submit').click();await page.locator('#deep-candidates input').first().check();
  await page.locator('#deep-source-preview').click();await page.locator('#deep-files input').first().waitFor();
  const card=page.locator('.deep-file-card').first();
  const identity=card.locator('details').filter({has:page.locator('summary',{hasText:'Pinned source identity'})});
  assert.equal(await identity.count(),1,'Full source identity stays available through disclosure');
  assert.equal(await identity.getAttribute('open'),null,'Revision is secondary to choosing files');
  assert.equal(await card.locator('input:disabled').count(),1,'Unsupported sources remain visible and disabled');
  assert.match(await card.innerText(),/only JS and TS supported/,'Disabled choice explains the reason');
  const enabled=card.locator('input:enabled');await enabled.last().check();
  assert.match(await page.locator('#deep-scope').innerText(),/ID 1: 2 file\(s\)/,'Selection still updates the exact comparison scope');
  await identity.locator('summary').click();assert.match(await identity.innerText(),/[a-f0-9]{40}/,'Full revision is readable on demand');
  await identity.locator('summary').click();
  await card.scrollIntoViewIfNeeded();await page.screenshot({path:`artifacts/hierarchy-first/${width}-source-files.png`});
  const overflow=await card.evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));assert.ok(overflow.scroll<=overflow.client+1,'File paths and identity fit the panel');
  await page.close();console.log('PASS hierarchy',width);
  }finally{await app.cleanup();}
 }
}finally{await browser.close();}
