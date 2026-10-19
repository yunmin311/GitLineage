/** Offline API envelopes + real mounted Discovery controls; no GitHub requests. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A,B} from './fixture-server.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
const out='artifacts/discovery-throttle';await mkdir(out,{recursive:true});
const browser=await chromium.launch(),geometry:unknown[]=[];
try{for(const width of [1280,390,430]){
 const f=treeFixture(),app=await fixtureServer({publicExploration:true,phaseDelayMs:0,explorationCooldownMs:2000,explorationTransport:f.transport});
 const page=await browser.newPage({viewport:{width,height:932},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 try{
  await page.goto(app.url+'/'+A);await page.locator('#workspace-candidates').click();await page.locator('#deep-repository').fill('root/example');
  await page.locator('#deep-search-submit').click();await page.locator('#deep-candidates input').first().waitFor();await page.locator('#deep-candidates input').first().check();
  await page.locator('#deep-status .deep-cooldown').waitFor();assert.equal(await page.locator('#deep-search-submit').isDisabled(),true);
  await page.locator('#deep-repository').focus();const normalCalls=f.calls.length;
  await page.waitForFunction(()=>!(document.querySelector('#deep-search-submit') as HTMLButtonElement).disabled);
  assert.equal(f.calls.length,normalCalls,'Ordinary stage cooldown must not start another request');assert.equal(await page.locator('#deep-repository').evaluate(n=>n===document.activeElement),true);
  const candidates=await page.locator('#deep-candidates').innerText(),calls=f.calls.length;let posts=0;
  await page.route('**/api/deep-search/search',r=>{posts++;return r.fulfill({status:429,json:{code:'ANONYMOUS_START_INTERVAL',error:'Diagnostic wording is not a state machine',retryAt:new Date(Date.now()+3000).toISOString()}});});
  await page.locator('#deep-search-submit').click();await page.locator('#deep-status').filter({hasText:'Please wait before starting a new search'}).waitFor();
  await page.screenshot({path:`${out}/${width}-before-or-after.png`});
  assert.equal(await page.locator('#deep-status').getAttribute('data-state'),'notice');assert.match(await page.locator('#deep-status').innerText(),/3 s/);
  assert.equal(await page.locator('#deep-search-submit').isDisabled(),true);assert.equal(await page.locator('#deep-repository').isEnabled(),true);assert.equal(await page.locator('#deep-source-preview').isEnabled(),true,'Address new-search interval must not block source stages');
  await page.locator('#deep-repository').focus();
  await page.locator('#deep-repository').evaluate(n=>{const form=n.closest('form')!;form.requestSubmit();form.requestSubmit();});
  assert.equal(posts,1);assert.equal(await page.locator('#deep-candidates').innerText(),candidates);assert.equal(await page.locator('#deep-candidates input').first().isChecked(),true);assert.equal(f.calls.length,calls);
  await page.waitForFunction(()=>!(document.querySelector('#deep-search-submit') as HTMLButtonElement).disabled);
  assert.equal(posts,1);assert.equal(await page.locator('#deep-repository').inputValue(),'root/example');assert.equal(await page.locator('#deep-repository').evaluate(n=>n===document.activeElement),true);
  // Sources remain usable when only a new-search interval is blocked.
  assert.equal(await page.locator('#deep-source-preview').isEnabled(),true);
  for(const code of ['SERVICE_BUSY','ANONYMOUS_ADDRESS_QUOTA','ANONYMOUS_GLOBAL_QUOTA','GITHUB_RATE_LIMIT','NETWORK_ERROR','INTERNAL_ERROR']){
   await page.unroute('**/api/deep-search/search');
   await page.route('**/api/deep-search/search',r=>r.fulfill({status:code==='NETWORK_ERROR'?502:code==='INTERNAL_ERROR'?500:429,json:{code,error:'Fixture '+code,...(code.includes('QUOTA')||code==='GITHUB_RATE_LIMIT'?{retryAt:new Date(Date.now()+1000).toISOString()}:{})}}));
   await page.locator('#deep-search-submit').click();await page.locator('#deep-status').filter({hasText:({SERVICE_BUSY:'shared service is busy',ANONYMOUS_ADDRESS_QUOTA:'address has used',ANONYMOUS_GLOBAL_QUOTA:'shared hourly',GITHUB_RATE_LIMIT:'GitHub is temporarily',NETWORK_ERROR:'Fixture NETWORK_ERROR',INTERNAL_ERROR:'Fixture INTERNAL_ERROR'} as Record<string,string>)[code]}).waitFor();
   assert.equal(await page.locator('#deep-status').getAttribute('data-state'),['NETWORK_ERROR','INTERNAL_ERROR'].includes(code)?'failed':'notice');
   assert.equal(await page.locator('#deep-candidates input').first().isChecked(),true);assert.equal(await page.locator('#deep-candidates').innerText(),candidates);
   await page.waitForFunction(()=>!(document.querySelector('#deep-search-submit') as HTMLButtonElement).disabled);
  }
  const rect=await page.locator('#workspace-discovery').evaluate(n=>{const b=n.getBoundingClientRect();return {left:b.left,right:b.right,scroll:n.scrollWidth,client:n.clientWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth};});geometry.push({width,...rect});assert.ok(rect.left>=0&&rect.right<=width+1&&rect.scroll<=rect.client+1&&rect.doc<=width);
  await page.screenshot({path:`${out}/${width}-recovered.png`});
  // A deadline belongs to its service, not the old repository's DOM generation.
  await page.unroute('**/api/deep-search/search');await page.route('**/api/deep-search/search',r=>r.fulfill({status:429,json:{code:'DISCOVERY_COOLDOWN',error:'Stage wait',retryAt:new Date(Date.now()+1000).toISOString()}}));
  await page.locator('#deep-search-submit').click();await page.locator('#deep-status[data-state=notice]').waitFor();
  await page.locator('#workspace-origins').click();await page.locator('.brand').click();await page.fill('#repo-input',B);await page.click('#submit');await page.locator('#workspace-candidates').click();
  assert.equal(await page.locator('#deep-repository').inputValue(),B);await page.waitForFunction(()=>!(document.querySelector('#deep-search-submit') as HTMLButtonElement).disabled);
  assert.equal(await page.locator('#deep-candidates input').count(),0);console.log(`PASS ${width}px cooldown, refusal preservation, focus, recovery and repository switch`);
 }finally{await page.close();await app.cleanup();}
}}finally{await browser.close();await writeFile(out+'/geometry.json',JSON.stringify(geometry,null,2));}
