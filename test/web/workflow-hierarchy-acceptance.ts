/** Navigation focus and candidate reading order; fixed offline transport only. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
await mkdir('artifacts/workflow-hierarchy',{recursive:true});
const browser=await chromium.launch(),geometry:unknown[]=[];
try {for(const width of [390,430,1280]){
 const f=unifiedFixture(),app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:f.transport});
 const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 try {
  await page.goto(app.url+'/'+A);await page.locator('#workspace-history').click();await page.locator('.history-row').first().click();
  await page.screenshot({path:`artifacts/workflow-hierarchy/${width}-history-detail.png`});
  if(width<768){
   assert.equal(await page.locator('#history-more').isVisible(),false,'List pagination does not compete with the mobile commit detail');
   await page.getByRole('button',{name:'← Commit list',exact:true}).click();
   assert.equal(await page.locator('.history-row.is-selected').evaluate(n=>document.activeElement===n),true,'Returning to the list restores keyboard focus to its selected commit');
   assert.equal(await page.locator('#history-more').isVisible(),true,'Earlier commits remain available in the list');
   await page.locator('.history-row.is-selected').click();
  }
  await page.locator('#history-return').click();
  if(width<768)await page.locator('[data-mobile-view=relations]').click();
  else if(await page.locator('#rail-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#rail-toggle').click();
  await page.locator('#workspace-candidates').click();await page.locator('#deep-repository').fill(A);await page.locator('#deep-search-submit').click();
  const card=page.locator('.deep-candidate').first();await card.waitFor();await card.scrollIntoViewIfNeeded();
  assert.equal(await card.locator('label').innerText(),'old/example','The selection label foregrounds the repository name');
  assert.match(await card.innerText(),/ID 2/,'Stable identity is retained as secondary metadata');
  assert.match(await card.innerText(),/Verification: pending · Lineage claim: none/,'Evidence boundaries remain visible');
  const provenance=card.locator('details');await provenance.locator('summary').click();
  assert.match(await provenance.innerText(),/query:.*page.*rank/s,'Search provenance is readable without exporting JSON');
  await provenance.locator('summary').click();await card.locator('input').check();
  assert.match(await page.locator('#deep-source-preview').innerText(),/1 selected/,'The next step states its selection scope');
  await card.scrollIntoViewIfNeeded();
  const measures=await card.evaluate(n=>{const label=n.querySelector('label')!,meta=n.querySelector('.deep-candidate-meta')!,summary=n.querySelector('summary')!;return{card:n.getBoundingClientRect().toJSON(),label:label.getBoundingClientRect().toJSON(),metaFont:getComputedStyle(meta).fontSize,summary:summary.getBoundingClientRect().toJSON()};});
  assert.ok(parseFloat(measures.metaFont)<13,'Identity metadata is visually secondary to the repository name');
  assert.ok(measures.label.height>=44&&measures.summary.height>=44,'Selection and provenance remain touch targets');geometry.push({width,...measures});
  await page.screenshot({path:`artifacts/workflow-hierarchy/${width}-discovery.png`});
  const overflow=await card.evaluate(n=>n.scrollWidth-n.clientWidth);assert.ok(overflow<=1,'Candidate metadata stays within its panel');
  await page.locator('#deep-source-preview').click();await page.locator('#deep-files input').first().waitFor();
  console.log('PASS workflow hierarchy',width);
 }finally{await page.close();await app.cleanup();}
}}finally{await browser.close();await writeFile('artifacts/workflow-hierarchy/geometry.json',JSON.stringify(geometry,null,2));}
