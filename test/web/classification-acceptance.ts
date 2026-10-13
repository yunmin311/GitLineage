/** Before: pebrel's 45-way branch had zero classifications and flat entity details.
 * Evidence-backed scope/site navigation must agree with entity details. */
import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
const out=resolve('artifacts/classification/after');await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0}),browser=await chromium.launch({headless:true});const results=[];
try{for(const width of [1920,1280,430,390]){
 const page=await browser.newPage({viewport:{width,height:width<768?900:1080},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url+'/'+A);await page.locator('.classification-node').first().waitFor();
 const module=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 const runtime=page.locator('.classification-node').filter({has:page.locator('.classification-label',{hasText:/Runtime/})}).filter({has:page.locator('.classification-caption',{hasText:'41 relationships'})});
 assert.equal(await runtime.count(),1);assert.equal(await page.locator('.category-level-2').count()>=2,true);
 const categoryId=await runtime.getAttribute('data-category-id');await runtime.focus();await page.keyboard.press('Enter');
 assert.equal(await runtime.getAttribute('aria-expanded'),'false');assert.equal(await page.locator(`.classification-node[data-parent-id="${categoryId}"]`).count(),0);
 await page.reload();await runtime.waitFor();assert.equal(await runtime.getAttribute('aria-expanded'),'false','Collapse survives refresh');
 await runtime.focus();await page.keyboard.press('Enter');assert.equal(await runtime.getAttribute('aria-expanded'),'true');
 await module.locator('.aggregate-more').focus();await page.keyboard.press('Enter');
 const second=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'mobile/link'})});await second.focus();await page.keyboard.press('Enter');
 const geometry=await page.evaluate(()=>{
  const svg=document.querySelector<SVGSVGElement>('#canvas')!;
  const boxes=[...svg.querySelectorAll<SVGGraphicsElement>('.node-box,.bundle-card-box,.classification-box')].map(n=>{const b=n.getBBox();return {x:b.x,y:b.y,w:b.width,h:b.height};});
  const ids=[...svg.querySelectorAll<SVGGElement>('.node')].map(n=>n.dataset.nodeId);
  const categories=[...svg.querySelectorAll<SVGGElement>('.classification-node')].map(n=>({id:n.dataset.categoryId,parent:n.dataset.parentId}));
  const links=[...svg.querySelectorAll<SVGGElement>('.group-navigation')].map(n=>({source:n.dataset.navigationSource,target:n.dataset.navigationTarget,arrow:n.querySelector('path')?.getAttribute('marker-end')}));
  return {boxes,ids,categories,links,stage:svg.getBoundingClientRect().toJSON(),ctm:svg.getScreenCTM()?.toString()};
 });assert.equal(new Set(geometry.ids).size,geometry.ids.length,'Real object remains unique');
 for(let i=0;i<geometry.boxes.length;i++)for(let j=i+1;j<geometry.boxes.length;j++){const a=geometry.boxes[i]!,b=geometry.boxes[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'All hierarchy levels clear neighboring nodes');}
 for(const n of geometry.categories)assert.ok(geometry.links.some(l=>l.source===n.parent&&l.target===n.id),'Each category has an explicit parent connector');assert.ok(geometry.links.every(l=>!l.arrow),'Navigation never claims lineage');
 await module.locator('.aggregate-focus').focus();await page.keyboard.press('Enter');
 if(width>=768)await page.locator('body').click({position:{x:1900<width?1900:width-10,y:15}});
 await page.screenshot({path:resolve(out,`${width}-classified-branches.png`)});
 const member=page.locator('.aggregate-member').filter({has:page.locator('.node-label',{hasText:'cargo:serde_path_to_error'})});await member.focus();await page.keyboard.press('Enter');
 if(width<768)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
 await page.locator('#drawer .d-hierarchy').waitFor({state:'visible'});const text=await page.locator('#drawer .d-hierarchy').textContent();assert.match(text||'',/nebula_app/);assert.match(text||'',/Runtime/);assert.match(text||'',/Declared here only/);assert.match(text||'',/Manifest scope: runtime/);
 await page.screenshot({path:resolve(out,`${width}-entity-hierarchy.png`)});
 if(width<768){await page.locator('#mobile-nav [data-mobile-view=graph]').click();assert.match(await page.locator('.graph-focus-path').textContent()||'',/Runtime.*Declared here only/);
  const target=await member.boundingBox(),overview=await page.locator('#graph-overview').boundingBox();assert.ok(target&&overview);assert.ok(target.x+target.width<=overview.x||target.x>=overview.x+overview.width||target.y+target.height<=overview.y||target.y>=overview.y+overview.height,'Overview does not cover the focused entity');
  await page.screenshot({path:resolve(out,`${width}-focused-classification.png`)});}
 assert.deepEqual(errors,[]);results.push({width,...geometry,status:'PASS'});await page.close();
}await writeFile(resolve(out,'geometry.json'),JSON.stringify(results,null,2));console.log('PASS: evidence-backed categories, unique entities, explicit parent links, distinct levels, local collapse/refresh, matching entity paths; 1920 / 1280 / 430 / 390.');
}finally{await browser.close();await app.cleanup();}
