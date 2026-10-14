/** Offline display regression: compact identity, contained glyphs and shared Inspector actions. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out=resolve('artifacts/surfaces',process.env.UI_EVIDENCE_PHASE||'after');await mkdir(out,{recursive:true});
const f=unifiedFixture();const filename='long-file-name-with-readable-evidence-and-version-context.ts';
f.repos[0]!.files[filename]=Buffer.from('export const readable = true;');f.rebuild();
const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,phaseDelayMs:0,explorationTransport:f.transport});
const browser=await chromium.launch();const results=[];
try {for(const width of [1920,1280,430,390]){
 const mobile=width<768,page=await browser.newPage({viewport:{width,height:mobile?932:1080},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('#workspace-history').waitFor();const root=page.locator('.node').filter({has:page.locator('.subject-tag')});await root.focus();await root.press('Enter');await page.locator('#drawer-inner .d-head').waitFor({state:'attached'});
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
 await page.screenshot({path:resolve(out,`${width}-repository.png`)});
 const heading=await page.locator('#crumb-repo').evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),rect:n.getBoundingClientRect().toJSON(),overflow:n.scrollWidth>n.clientWidth}));
 assert.ok(heading.font<=18,'Repository identity belongs to compact app chrome, not the page-title scale');
 if(!mobile){const centers=await page.locator('.appbar-mid > :not([hidden])').evaluateAll(ns=>ns.filter(n=>getComputedStyle(n).display!=='none').map(n=>{const r=n.getBoundingClientRect();return r.y+r.height/2;}));assert.ok(Math.max(...centers)-Math.min(...centers)<=1,'Identity, revision and cache share one center axis');}
 await page.locator('#workspace-node-structure').click();await page.locator('.unified-node.kind-file').first().waitFor({state:'attached'});
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=graph]').click();
 const long=page.locator('.unified-node.kind-file').filter({has:page.locator('title',{hasText:filename})});await long.focus();await long.press('Enter');
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
 await page.evaluate(()=>document.fonts.ready);
 const glyph=await long.evaluate(n=>{const box=n.querySelector<SVGGraphicsElement>('.node-box')!.getBBox();return{box:{x:box.x,y:box.y,width:box.width},labels:[...n.querySelectorAll<SVGTextElement>('text')].map(t=>({x:Number(t.getAttribute('x')),length:t.getComputedTextLength(),text:t.textContent}))};});
 assert.ok(glyph.labels.every(t=>t.x+t.length<=glyph.box.x+glyph.box.width-10),'Real long file-name glyphs remain inside the painted node boundary');
 assert.equal(await long.locator('title').textContent(),filename,'Truncation preserves the complete object identity');
 const drawer=page.locator('#drawer-inner');assert.equal(await drawer.locator('.d-head').innerText(),filename,'Structure Inspector uses the shared identity component');
 const loose=await drawer.locator('.unified-inspector > button').count();assert.equal(loose,0,'Inspector operations belong to consistently spaced action groups');
 const overflow=await drawer.evaluate(n=>({client:n.clientWidth,scroll:n.scrollWidth}));assert.ok(overflow.scroll<=overflow.client,'Long object identity stays inside the reading column');
 await page.screenshot({path:resolve(out,`${width}-file-inspector.png`)});
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=graph]').click();else await page.locator('#zoom-fit').click();
 await page.screenshot({path:resolve(out,`${width}-structure.png`)});results.push({width,heading,glyph,overflow});
 if(mobile){await page.goto(app.url);await page.locator('#repo-input').waitFor();const input=await page.locator('#repo-input').evaluate(n=>({height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)}));assert.ok(input.height>=44&&input.font>=16,'Mobile landing input retains a full touch target and readable type when its form changes to a column');await page.screenshot({path:resolve(out,`${width}-landing.png`)});}
 await page.close();
}await writeFile(resolve(out,'geometry.json'),JSON.stringify(results,null,2));console.log('PASS compact appbar and contained structure labels / Inspector actions at four widths');
}finally{await browser.close();await app.cleanup();}
