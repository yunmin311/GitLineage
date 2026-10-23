/** Real cached Express graph: an initial neighborhood must be readable without panning. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtureServer} from './fixture-server.ts';
const out=new URL('../../artifacts/initial-neighborhood/',import.meta.url).pathname;await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0}),browser=await chromium.launch(),results=[];
try{for(const width of [390,430,1280]){
 const page=await browser.newPage({viewport:{width,height:width<768?844:900},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+'/expressjs/express');await page.locator('.bundle-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);
 const geometry=()=>page.evaluate(()=>{
 const canvas=document.querySelector<SVGSVGElement>('#canvas')!,stage=canvas.getBoundingClientRect(),ctm=canvas.getScreenCTM()!;
 const rect=(n:Element)=>n.getBoundingClientRect().toJSON();
 const hit=(n:Element)=>{const b=n.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return b.x>=0&&b.right<=innerWidth&&b.y>=0&&b.bottom<=innerHeight&&[[x,y],[b.x+2,b.y+2],[b.right-2,b.bottom-2]].every(([px,py])=>document.elementFromPoint(px!,py!)?.closest('.bundle-card')===n.closest('.bundle-card'));};
 const middle=new DOMPoint(stage.x+stage.width/2,stage.y+stage.height/2).matrixTransform(ctm.inverse());
 return {stage:stage.toJSON(),ctm:{a:ctm.a,d:ctm.d,e:ctm.e,f:ctm.f},worldFocal:{x:middle.x,y:middle.y},viewBox:canvas.getAttribute('viewBox'),url:location.href,overflow:document.documentElement.scrollWidth>innerWidth+1,
 nodes:[...canvas.querySelectorAll('.node')].map(n=>({id:n.getAttribute('data-node-id'),bounds:rect(n)})),groups:[...canvas.querySelectorAll('.bundle-card')].map(n=>({key:n.getAttribute('data-bundle-key'),bounds:rect(n),hit:hit(n)})),
 controls:[...canvas.querySelectorAll('.aggregate-focus .plate-row-hit,.aggregate-more .plate-row-hit')].map(n=>({kind:n.parentElement?.getAttribute('class'),bounds:rect(n),hit:hit(n)}))};});
 const initial=await geometry();await page.screenshot({path:out+`${width}-initial.png`});results.push({width,initial});await writeFile(out+'geometry.json',JSON.stringify(results,null,2));
 assert.ok(initial.groups.some(g=>g.hit),'At least one complete, unoccluded relationship group is immediately clickable');
 const focus=page.locator('.aggregate-focus .plate-row-hit');
 const control=initial.controls.find(c=>c.kind==='aggregate-focus'&&c.hit);
 assert.ok(control,'Focus is visible without manually panning');if(width<768)assert.ok(initial.controls.some(c=>c.kind==='aggregate-more'&&c.hit),'Explore more is fully reachable above the bottom toolbar');if(width<768)assert.ok(control.bounds.height>=44-.5,'Focus retains a 44px touch target');
 if(width<768)await focus.first().tap();else await focus.first().click();
 await page.waitForTimeout(100);const focused=await geometry();assert.ok(await page.locator('.aggregate-member.is-selected').count()>0||width>=768,'Focus reaches a real member');
 // Group expansion is local: preserve the focused camera, URL selection and focus.
 const more=page.locator('.aggregate-more').first();await more.focus();const retained=await geometry(),memberCount=await page.locator('.aggregate-member').count();await page.keyboard.press('Enter');await page.waitForTimeout(100);const expanded=await geometry();assert.equal(expanded.viewBox,retained.viewBox);assert.equal(new URL(expanded.url).searchParams.get('node'),new URL(retained.url).searchParams.get('node'));
 assert.ok(await page.locator('.aggregate-member').count()<=memberCount+(width<768?5:8),'Expansion stays bounded');assert.equal(expanded.overflow,false);assert.deepEqual(errors,[]);
 Object.assign(results.at(-1)!,{focused,expanded,errors});await page.screenshot({path:out+`${width}-expanded.png`});await writeFile(out+'geometry.json',JSON.stringify(results,null,2));await page.close();
}console.log('PASS initial real neighborhood, touch hit targets, bounded expansion and retained camera/selection');}finally{await browser.close();await app.cleanup();}
