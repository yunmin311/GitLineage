/** Offline History controls: branch highlighting and in-log continuation. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const f=unifiedFixture(),app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:f.transport});
const geometry:unknown[]=[];
const browser=await chromium.launch(),before=process.env.CAPTURE_BEFORE==='1';
await mkdir('artifacts/history-controls',{recursive:true});
try {for(const width of [390,430,1280,1920]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('#workspace-history').click();await page.locator('.history-row').first().waitFor();
 await page.screenshot({path:`artifacts/history-controls/${width}-${before?'before':'after'}.png`});
 if(!before){
  assert.equal(await page.locator('.history-list #history-more').count(),1,'Continuation belongs to the scrollable log, not a full-width footer');
  const initialCount=await page.locator('.history-row').count();
  const chooser=page.locator('.history-branch-picker');
  await chooser.locator('summary').focus();await page.keyboard.press('Enter');
  const feature=chooser.getByRole('button',{name:'feature/modules',exact:true});await feature.click();
  assert.equal(await chooser.getAttribute('open'),null,'Selection closes the branch panel');
  assert.match(await chooser.locator('summary').innerText(),/feature\/modules/);
  assert.ok(await page.locator('.history-row.is-muted').count()>0,'Branch highlighting distinguishes reachable commits');
  assert.equal(await page.locator('.history-row').count(),initialCount,'Highlighting preserves all recorded commits');
  await chooser.locator('summary').click();await page.keyboard.press('Escape');
  assert.equal(await chooser.getAttribute('open'),null,'Escape closes branch choices');
  assert.equal(await chooser.locator('summary').evaluate(n=>n===document.activeElement),true,'Escape restores trigger focus');
  await chooser.locator('summary').click();await chooser.getByRole('button',{name:'All branches',exact:true}).click();
  assert.equal(await page.locator('.history-row.is-muted').count(),0,'All branches restores complete emphasis');
  await chooser.locator('summary').click();
  await page.screenshot({path:`artifacts/history-controls/${width}-branches.png`});
  const bounds=await chooser.evaluate(n=>{const summary=n.querySelector('summary')!.getBoundingClientRect(),menu=n.querySelector('.history-branch-choices')!.getBoundingClientRect(),option=n.querySelector('button')!,r=option.getBoundingClientRect();return{summary:summary.toJSON(),menu:menu.toJSON(),optionHeight:r.height,hit:option.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
  geometry.push({width,...bounds});
  assert.ok(bounds.summary.height>=44&&bounds.optionHeight>=44&&bounds.hit,'Branch controls have exposed touch targets');
  assert.ok(bounds.menu.left>=0&&bounds.menu.right<=width&&bounds.menu.bottom<=900,'Branch choices fit the viewport');
  assert.equal(await chooser.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'Long branch choices stay within their region');
  await page.locator('.history-heading').click();
  assert.equal(await chooser.getAttribute('open'),null,'Clicking outside dismisses branch choices');
  await page.locator('input[name=history-search]').fill('Earlier');
  const rows=await page.locator('.history-row').count(),selectedSha=await page.locator('.history-row.is-selected').getAttribute('data-sha');
  await page.route('**/api/explore/*/history',r=>r.fulfill({status:503,json:{error:'Offline continuation failed'}}));
  await page.locator('#history-more').click();
  await page.locator('.history-footer-note').filter({hasText:'Offline continuation failed'}).waitFor();
  assert.equal(await page.locator('.history-row').count(),rows,'Failed continuation retains commits');
  assert.equal(await page.locator('#history-more').isEnabled(),true,'Failed continuation remains retryable');
  assert.equal(await page.locator('input[name=history-search]').inputValue(),'Earlier','Failed continuation retains search');
  await page.unroute('**/api/explore/*/history');
  await chooser.locator('summary').click();await chooser.getByRole('button',{name:'feature/modules',exact:true}).click();
  await page.locator('#history-more').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(n=>document.querySelectorAll('.history-row').length>n,rows);
  assert.equal(await page.locator('#git-history').evaluate(n=>n.contains(document.activeElement)&&document.activeElement?.classList.contains('history-row')),true,'Successful continuation restores keyboard focus to a newly read commit');
  assert.equal(await page.locator('.history-row.is-selected').getAttribute('data-sha'),selectedSha,'Reading earlier commits retains selected commit');
  assert.match(await page.locator('.history-branch-picker > summary').innerText(),/feature\/modules/,'Reading earlier commits retains branch emphasis');
  assert.equal(await page.locator('input[name=history-search]').inputValue(),'Earlier','Reading earlier commits retains search');
  assert.equal(await page.locator('#git-history').evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'Controls fit narrow screens');
 }
 await page.close();console.log('PASS History controls',width,before?'before':'after');
}}finally{await browser.close();await app.cleanup();await writeFile('artifacts/history-controls/geometry.json',JSON.stringify(geometry,null,2));}
