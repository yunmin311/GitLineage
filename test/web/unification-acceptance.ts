/** Offline, painted geometry and interaction checks for group exploration. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
const out=resolve('artifacts/unification/after');await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0});const browser=await chromium.launch({headless:true});
const results=[];
try{for(const width of [430,1280,1920]){
 const page=await browser.newPage({viewport:{width,height:width===430?932:1080},hasTouch:width===430,isMobile:width===430,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('.bundle-card').first().waitFor();
 const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 await group.focus();await page.keyboard.press('Enter');
 assert.ok(await page.locator('.aggregate-member').count()>0,'Expand must expose real member nodes on the canvas');
 const probe=await page.evaluate(()=>{
  const cards=[...document.querySelectorAll<SVGGElement>('#canvas .bundle-card')];
  const overflow=cards.flatMap(g=>{const b=g.querySelector<SVGGraphicsElement>('.bundle-card-box')!.getBBox();return [...g.querySelectorAll<SVGTextElement>('text')].filter(t=>{const r=t.getBBox();return r.x<b.x-1||r.y<b.y-1||r.x+r.width>b.x+b.width+1||r.y+r.height>b.y+b.height+1;}).map(t=>t.textContent);});
  const nodes=[...document.querySelectorAll<SVGGraphicsElement>('.aggregate-member .node-box')].map(n=>{const b=n.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};});
  return{overflow,nodes,ctm:document.querySelector<SVGSVGElement>('#canvas')!.getScreenCTM()?.toString()};
 });assert.deepEqual(probe.overflow,[],'Every visible plate glyph belongs inside its painted border');
 for(let i=0;i<probe.nodes.length;i++)for(let j=i+1;j<probe.nodes.length;j++){const a=probe.nodes[i]!,b=probe.nodes[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'Member cards do not overlap');}
 await page.locator('#zoom-fit').click();
 await page.screenshot({path:resolve(out,`${width}-graph-expanded.png`)});
 const first=await page.locator('.aggregate-member').first().getAttribute('data-node-id');
 if(width===430){const hit=await page.locator('.aggregate-next .plate-row-hit').boundingBox();assert.ok(hit&&hit.height>=44,'Phone pagination has a real 44px hit target');await page.touchscreen.tap(hit!.x+hit!.width/2,hit!.y+hit!.height/2);}else{await page.locator('.aggregate-next').focus();await page.keyboard.press('Enter');}assert.notEqual(await page.locator('.aggregate-member').first().getAttribute('data-node-id'),first,'Next reveals additional real members');
 const visited=new Set<string>();
 await page.locator('.aggregate-previous').focus();await page.keyboard.press('Enter');
 for(let round=0;round<10;round++){
  for(const id of await page.locator('.aggregate-member').evaluateAll(ns=>ns.map(n=>(n as SVGGElement).dataset.nodeId!)))visited.add(id);
  if(await page.locator('.aggregate-next').getAttribute('aria-disabled')==='true')break;
  await page.locator('.aggregate-next').focus();await page.keyboard.press('Enter');
 }
 assert.equal(visited.size,45,'All 45 canonical members remain reachable through paging');
 await group.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.aggregate-member').count(),0,'Collapse restores overview');
 results.push({width,...probe,status:'PASS'});await page.close();
}
 const moving=await browser.newPage({viewport:{width:1280,height:900}});
 await moving.goto(app.url+'/'+A);await moving.locator('.bundle-card').first().waitFor();
 const initial=await moving.locator('#canvas').getAttribute('viewBox');
 await moving.locator('#zoom-in').click();await moving.waitForTimeout(70);
 await moving.screenshot({path:resolve(out,'motion-intermediate.png')});
 const intermediate=await moving.locator('#canvas').getAttribute('viewBox');assert.notEqual(intermediate,initial,'Camera visibly interpolates');
 await moving.waitForTimeout(300);await moving.screenshot({path:resolve(out,'motion-settled.png')});const settled=await moving.locator('#canvas').getAttribute('viewBox');assert.notEqual(settled,intermediate,'Intermediate geometry differs from settled geometry');
 await moving.locator('#zoom-out').click();await moving.waitForTimeout(60);
 await moving.mouse.move(620,180);await moving.mouse.down();await moving.mouse.up();
 const stopped=await moving.locator('#canvas').getAttribute('viewBox');await moving.waitForTimeout(300);assert.equal(await moving.locator('#canvas').getAttribute('viewBox'),stopped,'Pointer input cancels camera motion without later jumps');
 await moving.emulateMedia({reducedMotion:'reduce'});await moving.locator('#zoom-in').click();const reduced=await moving.locator('#canvas').getAttribute('viewBox');await moving.waitForTimeout(300);assert.equal(await moving.locator('#canvas').getAttribute('viewBox'),reduced,'Reduced motion settles immediately');assert.notEqual(reduced,stopped);
 await moving.close();console.log('PASS camera interpolation, interruption and reduced motion');
 await writeFile(resolve(out,'geometry.json'),JSON.stringify(results,null,2));console.log('PASS group expansion, paging, collapse and painted geometry at 430 / 1280 / 1920');}
finally{await browser.close();await app.cleanup();}
