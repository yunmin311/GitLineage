/** Oct13: all-layer default supersedes the old exclusive-provenance assertion.
 * Focus keeps the trunk and independent layer switches preserve exploration.
 * Offline spatial exploration regression. Fixed ranks and Next/Previous paging
 * assertions are obsolete: bounded local growth must preserve spatial context. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A,C,D,E} from './fixture-server.ts';
const out=resolve('artifacts/unification/after');await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0});const browser=await chromium.launch({headless:true});const results=[];
try{for(const width of [390,430,1280,1920]){
 const page=await browser.newPage({viewport:{width,height:width<768?844:1000},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+'/'+A);await page.locator('[data-perspective=dependencies]').waitFor();
 assert.ok(await page.locator('.bundle-card').count()>0,'Recorded dependencies remain visible when Origins is zero');
 assert.match(await page.locator('.graph-perspective-note').textContent()??'',/No recorded ancestry/);
 if(await page.locator('[data-perspective=dependencies]').getAttribute('aria-pressed')!=='true')await page.locator('[data-perspective=dependencies]').click();
 const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 if(await group.getAttribute('aria-expanded')!=='true'){await group.focus();await page.keyboard.press('Enter');}
 const count=await page.locator('.aggregate-member').count();assert.ok(count>0&&count<=16,'Expansion creates a bounded independent neighborhood');
 const initial=await page.locator('.aggregate-member').evaluateAll(ns=>Object.fromEntries(ns.map(n=>[(n as SVGGElement).dataset.nodeId,n.querySelector('.node-box')?.getAttribute('x')])));
 await group.locator('.aggregate-more').focus();await page.keyboard.press('Enter');
 const grown=await page.locator('.aggregate-member').count();assert.ok(grown>count&&grown<=32);
 const stable=await page.locator('.aggregate-member').evaluateAll(ns=>Object.fromEntries(ns.map(n=>[(n as SVGGElement).dataset.nodeId,n.querySelector('.node-box')?.getAttribute('x')])));for(const [id,x]of Object.entries(initial))assert.equal(stable[id],x,'Previously explored nodes stay in place');
 const second=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'mobile/link'})});if(await second.getAttribute('aria-expanded')!=='true'){await second.focus();await page.keyboard.press('Enter');}
 const probe=await page.evaluate(()=>{
  const svg=document.querySelector<SVGSVGElement>('#canvas')!;
  const boxes=[...svg.querySelectorAll<SVGGraphicsElement>('.node-box,.bundle-card-box,.classification-box')].map(n=>{const b=n.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};});
  const paths=[...svg.querySelectorAll<SVGGElement>('.edge-group')].map(g=>({id:g.dataset.relationshipId,source:g.dataset.source,target:g.dataset.target}));
  const c=svg.getScreenCTM()!;return{boxes,paths,ctm:{a:c.a,d:c.d,e:c.e,f:c.f},stage:svg.getBoundingClientRect().toJSON(),camera:svg.getAttribute('viewBox')};
 });for(let i=0;i<probe.boxes.length;i++)for(let j=i+1;j<probe.boxes.length;j++){const a=probe.boxes[i]!,b=probe.boxes[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'Real nodes and grouping controls do not overlap');}
 assert.ok(new Set(probe.boxes.map(b=>Math.round(b.x))).size>4&&new Set(probe.boxes.map(b=>Math.round(b.y))).size>4,'Neighborhood occupies two dimensions');assert.ok(probe.paths.every(p=>p.id&&p.source&&p.target&&!p.source.startsWith('bundle:')&&!p.target.startsWith('bundle:')),'Every painted line is a canonical entity relationship');
 if(width<768){await page.locator('.graph-group-jumps button').filter({hasText:'nebula_app'}).click();const step=page.getByRole('button',{name:'Next nearby object'});assert.ok((await step.boundingBox())!.height>=44);await step.click();assert.ok(await page.locator('.aggregate-member.is-selected').count());
 // With evidence-backed intermediate categories, the immediate category is the
 // visible parent endpoint; requiring the distant manifest on the phone would
 // force unreadable overview zoom. Include classification boxes in 2D clearance.
 const selected=page.locator('.aggregate-member.is-selected'),parentId=await selected.getAttribute('data-parent-id');
 const rootBox=parentId?.startsWith('category:')?await page.locator(`[data-category-id="${parentId}"]`).boundingBox():await group.boundingBox(),peerBox=await selected.boundingBox();for(const b of [rootBox,peerBox])assert.ok(b&&b.x>=0&&b.x+b.width<=width,'Local phone exploration frames both relationship endpoints');}else await page.locator('#zoom-fit').click();
 await page.screenshot({path:resolve(out,`${width}-graph-expanded.png`)});
 await group.focus();await page.keyboard.press('Enter');assert.ok(await page.locator('.aggregate-member').count()<grown+8,'Local collapse removes its neighborhood');
 await page.goto(app.url+'/'+D);await page.locator('.edge-group.fam-ancestry').first().waitFor({state:'attached'});await page.locator('.edge-group.fam-ancestry').first().focus();await page.keyboard.press('Enter');if(width<768)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();assert.ok(await page.locator('#drawer').isVisible(),'Fork evidence opens from its explicit semantic control');
 if(width<768)await page.locator('#mobile-evidence-back').click();else await page.keyboard.press('Escape');
 await page.screenshot({path:resolve(out,`${width}-fork.png`)});
 await page.goto(app.url+'/'+C);await page.locator('[data-perspective=dependencies]').waitFor();if(await page.locator('[data-perspective=dependencies]').getAttribute('aria-pressed')!=='true')await page.locator('[data-perspective=dependencies]').click();
 const groups=page.locator('.bundle-card');for(let i=0;i<await groups.count();i++){if(await groups.nth(i).getAttribute('aria-expanded')!=='true'){await groups.nth(i).focus();await page.keyboard.press('Enter');}}
 const coverage=page.locator('.node[data-node-id="pkg:pypi:coverage"]');await coverage.focus();await page.keyboard.press('Enter');
 const before=await page.locator('#canvas').getAttribute('viewBox');await page.locator('#graph-explore-node').click();if(await page.locator('[data-perspective=references]').getAttribute('aria-pressed')!=='true')await page.locator('[data-perspective=references]').click();
 assert.ok(await coverage.evaluate(n=>n.classList.contains('is-selected')),'Exploring a canonical package preserves its selection');assert.ok(await page.locator('.node[data-node-id="repo:github:coveragepy/coveragepy"]').count(),'Existing canonical second-hop reference is projected');await page.screenshot({path:resolve(out,`${width}-second-hop.png`)});
 await page.locator('#graph-back').click();assert.equal(await page.locator('#canvas').getAttribute('viewBox'),before,'Return restores exact previous camera');assert.ok(await coverage.count());
 await page.goto(app.url+'/'+E);await page.locator('[data-perspective=origins]').waitFor();assert.equal(await page.locator('.edge-group').count(),0);assert.equal(await page.locator('.node').count(),1);await page.screenshot({path:resolve(out,`${width}-no-lineage.png`)});
 assert.deepEqual(errors,[]);results.push({width,...probe,status:'PASS'});await page.close();
}
 const moving=await browser.newPage({viewport:{width:1280,height:900}});await moving.goto(app.url+'/'+D);await moving.locator('.edge-group').first().waitFor({state:'attached'});const initial=await moving.locator('#canvas').getAttribute('viewBox');await moving.locator('#zoom-in').click();await moving.waitForTimeout(70);const intermediate=await moving.locator('#canvas').getAttribute('viewBox');assert.notEqual(intermediate,initial);await moving.waitForTimeout(300);assert.notEqual(await moving.locator('#canvas').getAttribute('viewBox'),intermediate);await moving.emulateMedia({reducedMotion:'reduce'});await moving.locator('#zoom-out').click();const settled=await moving.locator('#canvas').getAttribute('viewBox');await moving.waitForTimeout(300);assert.equal(await moving.locator('#canvas').getAttribute('viewBox'),settled);await moving.close();
 await writeFile(resolve(out,'geometry.json'),JSON.stringify(results,null,2));console.log('PASS: coexisting relationship branches, bounded 2D neighborhoods, local stability, semantic endpoints, canonical second hop, exact Back, mobile navigation, reduced motion. 390 / 430 / 1280 / 1920.');
}finally{await browser.close();await app.cleanup();}
