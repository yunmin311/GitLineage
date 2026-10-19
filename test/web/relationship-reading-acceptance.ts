import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixtureServer, A, D } from './fixture-server.ts';

const app = await fixtureServer({phaseDelayMs:0});
const browser = await chromium.launch();
const before = process.env.CAPTURE_BEFORE === '1';
try {
 let edgeUrl = '';
 const phone = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await phone.goto(app.url+'/'+A);
 await phone.locator('[data-mobile-view=relations]').click();
 await phone.locator('#mobile-relations details').evaluateAll(ns=>ns.forEach(n=>(n as HTMLDetailsElement).open=true));
 await phone.locator('.mobile-relation-evidence').first().click();
 edgeUrl = new URL(phone.url()).pathname+new URL(phone.url()).search;
 await phone.close();
 for (const width of [390,430,1280,1920]) {
  const page = await browser.newPage({viewport:{width,height:width<768?844:900},isMobile:width<768,hasTouch:width<768});
  await page.goto(app.url+edgeUrl);
  if (width<768) await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
  await page.locator('.d-pair').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(400); // Let the existing Inspector entrance settle before pixel capture.
  await page.screenshot({path:`artifacts/relationship-reading/${width}-${before?'before':'after'}.png`});
  if (!before) {
   const drawer = page.locator('#drawer');
   const technical = drawer.locator('details.relationship-provenance');
   assert.equal(await technical.count(),1,'Recorded metadata is available in a secondary disclosure');
   assert.equal(await technical.getAttribute('open'),null,'Technical metadata is initially collapsed');
   const order = await drawer.evaluate(n=>{
    const meaning=n.querySelector('.d-why')!.getBoundingClientRect();
    const evidence=n.querySelector('.is-evidence')!.getBoundingClientRect();
    return meaning.top<evidence.top;
   });
   assert.ok(order,'Meaning and evidence boundary are explained before raw records');
   assert.equal(await drawer.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'Long identifiers remain within Inspector');
   const pair=drawer.locator('.d-pair');
   assert.equal(await pair.locator('[data-endpoint]').count(),2,'Both real relationship endpoints are present');
   const selection = new URL(page.url()).searchParams.get('edge');
   const ctm=await page.locator('#canvas').evaluate(n=>(()=>{const m=(n as unknown as SVGSVGElement).getScreenCTM()!;return [m.a,m.b,m.c,m.d,m.e,m.f].join(',');})());
   await technical.locator('summary').focus();
   await page.keyboard.press('Enter');
   assert.notEqual(await technical.getAttribute('open'),null,'Keyboard opens recorded metadata');
   assert.equal(new URL(page.url()).searchParams.get('edge'),selection,'Disclosure retains relationship selection');
   assert.equal(await page.locator('#canvas').evaluate(n=>(()=>{const m=(n as unknown as SVGSVGElement).getScreenCTM()!;return [m.a,m.b,m.c,m.d,m.e,m.f].join(',');})()),ctm,'Reading metadata does not move canvas');
   const hit=await technical.locator('summary').boundingBox();
   assert.ok(hit && hit.height>=44,'Metadata disclosure has a touch-sized target');
   assert.equal(await technical.locator('summary').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Focused metadata remains exposed above fixed navigation');
   await page.waitForTimeout(250);
   await page.screenshot({path:`artifacts/relationship-reading/${width}-provenance.png`});
  }
  if (!before) {
   const response=await page.request.get(app.url+'/api/view/'+D+'?depth=200');
   const {data:view}=await response.json();
   await page.goto(app.url+'/'+D+'?node='+encodeURIComponent(view.subject.id));
   if(width<768)await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
   await page.locator('.entity-metrics').waitFor();
   await page.screenshot({path:`artifacts/relationship-reading/${width}-counts-current.png`});
   const metrics=await page.locator('.entity-metrics > div').evaluateAll(ns=>ns.map(n=>({label:n.querySelector('span')!.textContent,count:Number(n.querySelector('strong')!.textContent),title:n.getAttribute('title')})));
   const relations=view.edges.filter((e:{source:string,target:string})=>e.source===view.subject.id||e.target===view.subject.id);
   for(const [id,label,families]of [['origins','Origins',['ancestry','source-identity']],['dependencies','Dependencies',['dependency']],['references','References',['attribution']]] as const){
    const expected=relations.filter((e:{family:string})=>(families as readonly string[]).includes(e.family)).length;
    assert.equal(metrics.find(m=>m.label===label)!.count,expected,'Inspector '+label+' uses the same relationship grouping as canvas tools');
    assert.equal(await page.locator('[data-perspective='+id+']').getAttribute('aria-label'),label+' · '+expected,'Root and graph totals agree for the same direct connections');
   }
   assert.match(metrics.find(m=>m.label==='Origins')!.title||'',/does not prove (ancestry|derivation)/,'Source identity retains its evidence boundary');
   await page.screenshot({path:`artifacts/relationship-reading/${width}-counts.png`});
  }
  await page.close();
 }
 console.log(before?'Captured existing relationship Inspector':'PASS relationship reading hierarchy, endpoints, keyboard, overflow and camera continuity (390/430/1280/1920)');
} finally {await browser.close();await app.cleanup();}
