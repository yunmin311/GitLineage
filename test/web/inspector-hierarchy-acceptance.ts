/** Offline regression for stacked Inspector headers and display hierarchy. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out=resolve('artifacts/refinement',process.env.UI_EVIDENCE_PHASE||'after');
await mkdir(out,{recursive:true});
const app=await fixtureServer({publicExploration:true,explorationTransport:unifiedFixture().transport,phaseDelayMs:0}),browser=await chromium.launch(),results=[];
try {for(const width of [1920,1280,430,390]){
 const mobile=width<768,page=await browser.newPage({viewport:{width,height:mobile?932:1080},isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
 await page.goto(app.url+'/'+A);await page.locator('#workspace-history').waitFor();
 await page.locator('.node').filter({has:page.locator('.subject-tag')}).press('Enter');
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
 const drawer=page.locator('#drawer-inner');await drawer.locator('.d-group-head').first().waitFor();
 await drawer.evaluate(n=>{n.querySelectorAll<HTMLDetailsElement>('details.d-classification').forEach(d=>d.open=true);n.scrollTop=700;});
 const geometry=await drawer.evaluate(n=>{const header=n.querySelector('.d-block-head')!,group=n.querySelector('.d-group-head')!;return {scroll:n.scrollTop,header:header.getBoundingClientRect().toJSON(),group:group.getBoundingClientRect().toJSON(),overflow:n.scrollWidth>n.clientWidth};});
 await page.screenshot({path:resolve(out,`${width}-scrolled-inspector.png`)});
 assert.ok(geometry.scroll>=700,'Fixture exercises a long expanded relationship index');
 assert.ok(geometry.group.top>=geometry.header.bottom-.5,'Sticky manifest heading must start below the relationship heading');
 assert.equal(geometry.overflow,false,'Inspector stays inside its reading column');
 const mask=await drawer.evaluate(n=>getComputedStyle(n).maskImage);
 assert.ok(mask==='none'||mask.startsWith('linear-gradient(rgb(0, 0, 0)'), 'Scroll fade must retain painted sticky headings at the top');
 await drawer.evaluate(n=>n.scrollTop=0);
 await page.screenshot({path:resolve(out,`${width}-repository.png`)});
 if(mobile)await page.locator('#mobile-nav [data-mobile-view=graph]').click();
 const group=page.locator('.graph-group').first();await group.press('Enter');await page.locator('.classification-node').first().waitFor({state:'attached'});
 const fills=await page.locator('.graph-group .bundle-card-box,.category-level-1 .classification-box,.category-level-2 .classification-box,.node-box.is-package').evaluateAll(ns=>ns.map(n=>({kind:n.getAttribute('class'),fill:getComputedStyle(n).fill})));
 assert.ok(new Set(fills.map(f=>f.fill)).size>=3,'Display tiers have distinct surfaces without changing relationship status colors');
 await page.locator('#zoom-fit').click();await page.screenshot({path:resolve(out,`${width}-hierarchy.png`)});
 results.push({width,geometry,fills});await page.close();
}await writeFile(resolve(out,'inspector-geometry.json'),JSON.stringify(results,null,2));console.log('PASS stacked Inspector headings and graph hierarchy at four widths');
}finally{await browser.close();await app.cleanup();}
