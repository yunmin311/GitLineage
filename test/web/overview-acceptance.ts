/** Overview is an explicit phone tool, not an obstruction above graph actions. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A} from './fixture-server.ts';
const app=await fixtureServer({phaseDelayMs:0});const browser=await chromium.launch();
const out='artifacts/design-breakthrough/overview';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [390,430]){
 const page=await browser.newPage({viewport:{width,height:1000},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('.bundle-card').first().waitFor();
 const toggle=page.locator('#overview-toggle');await toggle.waitFor({timeout:3000});
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#overview-map').isVisible(),false,'Phone map does not paint over node actions by default');
 const baseline=await page.locator('#canvas').evaluate((n:SVGSVGElement)=>({stage:n.getBoundingClientRect().toJSON(),ctm:n.getScreenCTM()!.toString(),box:n.getAttribute('viewBox')}));
 await toggle.click();await page.waitForFunction(()=>document.getElementById('overview-toggle')!.getAttribute('aria-expanded')==='true');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 const geometry=await page.locator('#overview-map').evaluate(n=>{const r=n.getBoundingClientRect();return{rect:r.toJSON(),visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#overview-map')===n};});
 assert.ok(geometry.visible,'Expanded overview has its own reachable map target');
 await page.screenshot({path:`${out}/${width}-open.png`});await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('overview-toggle')!.getAttribute('aria-expanded')==='false');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(n=>document.activeElement===n),true,'Dismissal returns focus to its tool');
 const after=await page.locator('#canvas').evaluate((n:SVGSVGElement)=>({stage:n.getBoundingClientRect().toJSON(),ctm:n.getScreenCTM()!.toString(),box:n.getAttribute('viewBox')}));assert.deepEqual(after,baseline,'Overview does not alter stage or camera');
 const actions=await page.locator('.bundle-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();const map=document.getElementById('graph-overview')!.getBoundingClientRect();return{rect:r.toJSON(),overlap:r.left<map.right&&r.right>map.left&&r.top<map.bottom&&r.bottom>map.top};}));
 assert.ok(actions.every(n=>!n.overlap),'Collapsed phone Overview clears every rendered group action');
 await page.screenshot({path:`${out}/${width}-closed.png`});results.push({width,baseline,geometry,actions});await page.close();
}await writeFile(`${out}/geometry.json`,JSON.stringify(results,null,2));console.log('PASS mobile Overview: explicit open/dismiss, hit target, focus and unchanged camera');}
finally{await browser.close();await app.cleanup();}
