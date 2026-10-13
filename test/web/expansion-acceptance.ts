/** Regression for expansion state; accepted node design stays unchanged. */
import {chromium,type Page,type Locator} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out=resolve('artifacts/expansion',process.env.UI_EVIDENCE_PHASE||'after');await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0}),browser=await chromium.launch({headless:true});
const results:any[]=[];
const activate=async(page:Page,node:Locator)=>{await node.focus();await page.keyboard.press('Enter');};
try{for(const width of [1920,430,390]){
 const page=await browser.newPage({viewport:{width,height:width<768?900:1080},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
 const start=async()=>{await page.goto(app.url+'/'+A);await page.locator('.classification-node').first().waitFor();};
 const module=()=>page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 const runtime=()=>page.locator('.classification-node').filter({has:page.locator('.classification-caption',{hasText:'41 relationships'})});
 const members=()=>page.locator('.aggregate-member').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-node-id')).sort());
 const check=async(name:string,run:()=>Promise<void>)=>{await start();try{await run();results.push({width,name,status:'PASS'});}catch(e){results.push({width,name,status:'FAIL',error:String(e)});await page.screenshot({path:resolve(out,`${width}-${name}.png`)});}};
 await check('selected-collapse',async()=>{
  const member=page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]');const id=await member.getAttribute('data-node-id');
  await activate(page,member);await activate(page,runtime());
  assert.equal(await page.locator(`.node[data-node-id="${id}"]`).count(),0,'Closed category must hide its selected descendant');
  assert.equal(new URL(page.url()).searchParams.get('node'),id,'Keep evidence selection while its branch is closed');
  await activate(page,runtime());assert.equal(await page.locator(`.node[data-node-id="${id}"]`).count(),1,'Reopening restores selected descendant');
 });
 await check('module-collapse',async()=>{
  const member=page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]');const id=await member.getAttribute('data-node-id');await activate(page,member);
  await activate(page,module());assert.equal(await page.locator(`.node[data-node-id="${id}"]`).count(),0,'Closed module must not leak selected members into root space');
  await activate(page,module());assert.equal(await page.locator(`.node[data-node-id="${id}"]`).count(),1);
 });
 await check('fully-collapsed-refresh',async()=>{
  for(const key of await page.locator('.bundle-card.is-expanded').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-bundle-key'))))await activate(page,page.locator(`.bundle-card[data-bundle-key="${key}"]`));
  assert.equal(await page.locator('.aggregate-member').count(),0);
  await page.reload();await page.locator('.bundle-card').first().waitFor();assert.equal(await page.locator('.bundle-card.is-expanded').count(),0,'Refresh must not reopen explicitly closed modules');
 });
 await check('more-refresh',async()=>{
  await activate(page,page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]'));
  await activate(page,module().locator('.aggregate-more'));await activate(page,module().locator('.aggregate-more'));
  const before=await members();await page.reload();await page.locator('.classification-node').first().waitFor({state:'attached'});
  if(width<768){await page.waitForTimeout(200);assert.equal(await page.locator('#explorer-body').getAttribute('data-mobile-view'),'graph','Restoring selection must not act like tapping the selected node again');}
  assert.deepEqual(await members(),before,'Refresh must preserve exactly the explored neighborhood');
 });
 await check('collapse-no-substitution',async()=>{
  const before=await members();await activate(page,runtime());const after=await members();
  assert.ok(after.every(id=>before.includes(id)),'Collapse must not spontaneously reveal unrequested members');
 });
 await check('more-opens-loaded-categories',async()=>{
  for(const id of await page.locator('.category-level-1').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-category-id'))))await activate(page,page.locator(`[data-category-id="${id}"]`));
  const before=await members();await activate(page,module().locator('.aggregate-more'));
  assert.ok((await members()).length>before.length,'Explore more must reveal newly admitted objects even after category collapse');
 });
 if(width<768)await check('category-reopen-admits-member',async()=>{
  const dev=page.locator('.classification-node').filter({has:page.locator('.classification-label',{hasText:'Development'})});
  await activate(page,dev);await activate(page,dev);
  assert.ok(await page.locator('.aggregate-member').filter({has:page.locator('.node-fact',{hasText:'DEVELOPMENT'})}).count()>0,'Opening a nonempty category must reveal at least one member');
 });
 if(width<768)await check('search-hidden-layer',async()=>{
  await activate(page,runtime());
  await page.getByRole('button',{name:'Dependencies · 97',exact:true}).click();
  await page.keyboard.press('/');await page.locator('#search-input').fill('serde_path_to_error');
  await page.locator('#mobile-search-results button').filter({hasText:'serde_path_to_error'}).click();
  assert.equal(await page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]').count(),1,'Search must locate objects even when their layer was hidden');
 });
 if(width<768)await check('search-closed-category',async()=>{
  await activate(page,runtime());await page.keyboard.press('/');await page.locator('#search-input').fill('serde_path_to_error');
  await page.locator('#mobile-search-results button').filter({hasText:'serde_path_to_error'}).click();
  assert.equal(await runtime().getAttribute('aria-expanded'),'true','Search must reopen ancestors of its located target');
  assert.equal(await page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]').count(),1,'Search target must actually be rendered');
 });
 if(width<768)await check('search-bounded-neighborhood',async()=>{
  const before=await members();await page.keyboard.press('/');await page.locator('#search-input').fill('cargo:tokio-util');
  await page.locator('#mobile-search-results button').filter({hasText:'cargo:tokio-util'}).click();
  assert.equal(await page.locator('.node[data-node-id="pkg:cargo:tokio-util"]').count(),1);
  const limits=JSON.parse(new URL(page.url()).searchParams.get('neighborhoods')||'[]');
  assert.ok(limits.every(([,limit]:[string,number])=>limit<=5),'Search must retain bounded admission budgets');
  // A newly opened branch admits five peers plus the explicitly located object.
  assert.ok((await members()).length<=before.length+6,'Locating a late member must not load every preceding relationship');
 });
 results.push({width,name:'runtime-errors',status:errors.length?'FAIL':'PASS',errors});await page.close();
}
const world=await fixtureServer({publicExploration:true,explorationCooldownMs:0,phaseDelayMs:0,explorationTransport:unifiedFixture().transport});
try{for(const width of [430,390]){
 const page=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await page.goto(world.url+'/'+A);await page.locator('#workspace-history').waitFor();
 const branch=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 await activate(page,branch.locator('.aggregate-more'));
 await activate(page,page.locator('.node[data-node-id="pkg:cargo:serde_path_to_error"]'));
 const measure=()=>page.locator('#canvas').evaluate(el=>{const svg=el as unknown as SVGSVGElement,ctm=svg.getScreenCTM()!,stage=svg.getBoundingClientRect(),focal=new DOMPoint(stage.x+stage.width/2,stage.y+stage.height/2).matrixTransform(ctm.inverse());return {stage:stage.toJSON(),ctm:[ctm.a,ctm.b,ctm.c,ctm.d,ctm.e,ctm.f],focal:[focal.x,focal.y],target:svg.querySelector('.node.is-selected .node-box')?.getBoundingClientRect().toJSON()};});
 const before=await measure();
 const camera=await page.locator('#canvas').getAttribute('viewBox');
 await page.reload();await page.locator('#workspace-history').waitFor();await page.waitForTimeout(250);
 const view=await page.locator('#explorer-body').getAttribute('data-mobile-view');
 const after=await measure();
 results.push({width,name:'workspace-selection-restore',status:view==='graph'?'PASS':'FAIL',view,before,after});
 await page.screenshot({path:resolve(out,`${width}-restored-selection.png`)});
 assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera,'Selection restoration preserves the exact camera');
 assert.deepEqual(after.focal,before.focal,'World focal point survives restoration');
 assert.ok(before.target&&after.target&&Math.abs(before.target.x-after.target.x)<1&&Math.abs(before.target.y-after.target.y)<1,'Restoring a grown neighborhood must keep the selected object at its screen position');
 await page.close();
}}finally{await world.cleanup();}
await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.status==='PASS'),'Expansion regressions');
}finally{await browser.close();await app.cleanup();}
