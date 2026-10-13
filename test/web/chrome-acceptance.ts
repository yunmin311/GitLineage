/** HUD belongs to uncovered stage pixels; preserve world scale across panels. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out=resolve('artifacts/chrome',process.env.UI_EVIDENCE_PHASE||'after');await mkdir(out,{recursive:true});
const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,phaseDelayMs:0,explorationTransport:unifiedFixture().transport});
const browser=await chromium.launch();const results:any[]=[];
try {for(const width of [1280,1920,1024,768,430,390]){
 const page=await browser.newPage({viewport:{width,height:width<768?900:1080},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('#workspace-history').waitFor();
 const measure=()=>page.evaluate(()=>{const rect=(el:Element)=>el.getBoundingClientRect().toJSON();const visible=(id:string)=>{const el=document.getElementById(id)!;return !el.hidden&&getComputedStyle(el).display!=='none'?rect(el):null;};const svg=document.getElementById('canvas') as unknown as SVGSVGElement,c=svg.getScreenCTM()!,s=svg.getBoundingClientRect(),f=new DOMPoint(s.x+s.width/2,s.y+s.height/2).matrixTransform(c.inverse());return{stage:rect(svg),ctm:[c.a,c.b,c.c,c.d,c.e,c.f],focal:[f.x,f.y],rail:visible('rail'),drawer:visible('drawer'),layers:rect(document.getElementById('graph-perspectives')!),overview:rect(document.getElementById('graph-overview')!),buttons:[...document.querySelectorAll('.graph-perspective-tabs button')].map(el=>({rect:rect(el),reachable:document.elementFromPoint(el.getBoundingClientRect().x+el.getBoundingClientRect().width/2,el.getBoundingClientRect().y+el.getBoundingClientRect().height/2)?.closest('button')===el})),selected:document.querySelector('.node.is-selected .node-box')?rect(document.querySelector('.node.is-selected .node-box')!):null};});
 const note=await page.locator('.graph-perspective-note').evaluate(n=>({display:getComputedStyle(n).display,background:getComputedStyle(n).backgroundColor}));assert.equal(note.background,'rgba(0, 0, 0, 0)','An inert note must not paint an opaque strip over graph nodes');
 const baseline=await measure();
 if(width>=768){if(await page.locator('#rail').isHidden())await page.locator('#rail-toggle').click();}
 const context=await measure();await page.screenshot({path:resolve(out,`${width}-context.png`)});
 if(width>=768){assert.ok(context.layers.left>=context.rail!.right+8,'Layer controls must clear the open Context panel');assert.ok(context.overview.left>=context.rail!.right+8,'Overview must clear the open Context panel');assert.deepEqual(context.stage,baseline.stage);assert.equal(context.ctm[0],baseline.ctm[0]);}
 assert.ok(context.buttons.every(b=>b.reachable),'Every layer button has an uncovered real hit target');
 const node=page.locator(width<768?'.node[data-node-id="pkg:cargo:serde_path_to_error"]':'.node[data-node-id="pkg:cargo:toml"]');await node.focus();await page.keyboard.press('Enter');
 const selected=await measure();
 const boundary=await node.evaluate(n=>{const box=n.querySelector('.node-box')!;return {outline:getComputedStyle(n).outlineStyle,stroke:getComputedStyle(box).stroke,ink:getComputedStyle(n).getPropertyValue('--ink').trim(),width:getComputedStyle(box).strokeWidth};});assert.equal(boundary.outline,'none','SVG focus must not frame the shadow-inclusive group');assert.equal(boundary.width,'2px','Selection is painted on the node boundary');
 await page.screenshot({path:resolve(out,`${width}-selected.png`)});
 if(width>=1600){assert.ok(selected.layers.right<=selected.drawer!.left-8,'Layers must clear evidence panel too');}
 const mark=await page.locator('.brand-mark').evaluate(n=>({svg:!!n.querySelector('svg'),background:getComputedStyle(n).backgroundColor}));assert.ok(mark.svg,'Explorer has the favicon graph mark');assert.equal(await page.locator('.brand-mark svg').getAttribute('viewBox'),'0 0 16 16');assert.equal(await page.locator('.brand-mark circle').count(),2,'Page logo reuses the two endpoints from the favicon');assert.equal(mark.background,'rgba(0, 0, 0, 0)');
 if(width>=1600){await node.locator('.node-box').click();await node.locator('.node-box').click();assert.equal(await node.getAttribute('class').then(c=>c?.includes('is-selected')),true,'Pointer selects the same node after clearing keyboard selection');assert.equal(await node.evaluate(n=>getComputedStyle(n).outlineStyle),'none','Pointer focus keeps the tight painted selection');}
 results.push({width,baseline,context,selected,boundary});await page.close();
}
 const detailPage=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 await detailPage.goto(app.url+'/'+A+'?node=repo%3Agithub%3Akuddev%2Fpebrel');
 await detailPage.locator('.entity-metrics').waitFor();
 assert.equal(await detailPage.locator('.d-group').count(),9,'The manifest index retains all nine declaring sites');
 assert.equal(await detailPage.locator('.d-group[open]').count(),1,'Only the leading relationship neighborhood opens initially');
 await detailPage.locator('.d-group > summary').nth(1).click();
 assert.equal(await detailPage.locator('.d-group[open]').count(),2,'Relationship neighborhoods expand independently');
 const scroll=await detailPage.locator('#drawer-inner').evaluate(e=>({width:e.clientWidth,overflow:e.scrollWidth>e.clientWidth}));assert.equal(scroll.overflow,false,'Inspector content stays inside its reading column');
 await detailPage.screenshot({path:resolve(out,'1920-repository-inspector.png')});await detailPage.close();
 await writeFile(resolve(out,'geometry.json'),JSON.stringify(results,null,2));console.log('PASS chrome: panels, HUD hit targets, geometry and logo at six widths');}
finally{await browser.close();await app.cleanup();}
