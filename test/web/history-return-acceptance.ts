/** Production-bundle Return target: geometry, real pointer hits and retained state. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium, type Page} from 'playwright';
import {fixtureServer, A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';

const phase=process.env.UI_EVIDENCE_PHASE || 'after';
const out=`artifacts/history-return/${phase}`;
await mkdir(out,{recursive:true});
const browser=await chromium.launch(), results:unknown[]=[], failures:string[]=[];
async function snapshot(page:Page){
 return page.evaluate(()=>{
  const svg=document.querySelector<SVGSVGElement>('#canvas')!, m=svg.getScreenCTM()!;
  const r=svg.getBoundingClientRect(), v=svg.viewBox.baseVal;
  return {url:location.href,camera:svg.getAttribute('viewBox'),stage:r.toJSON(),ctm:[m.a,m.b,m.c,m.d,m.e,m.f],
   focal:[v.x+v.width/2,v.y+v.height/2],selected:[...svg.querySelectorAll('.is-selected')].map(n=>n.getAttribute('data-node-id')||n.getAttribute('data-edge-id')||n.getAttribute('data-relationship-id')||n.getAttribute('data-display-edge')),
   readingScroll:document.querySelector('#drawer-inner')!.scrollTop,evidence:document.querySelector('#drawer-inner')!.innerHTML};
 });
}
try{for(const width of [1920,1280,430,390])for(const state of ['ready','failed']){
 const app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
 const page=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url+'/'+A);
  await page.locator('#canvas .node').first().waitFor();
  if(width<768){
   await page.locator('[data-mobile-view=relations]').click();
   await page.locator('#mobile-relations details').evaluateAll(ns=>ns.forEach(n=>(n as HTMLDetailsElement).open=true));
   await page.locator('.mobile-relation-evidence').first().click();
   await page.waitForURL(url=>url.searchParams.has('edge'));
  }else{
   await page.locator('#canvas .node.is-subject .node-hit').click();
   await page.waitForURL(url=>url.searchParams.has('node'));
  }
  const disclosure=page.locator('#drawer-inner details').first();
  // Node relationship groups may start open; explicitly close then use the key.
  if(await disclosure.getAttribute('open')!==null)await disclosure.locator(':scope > summary').click();
  await disclosure.locator(':scope > summary').focus();await page.keyboard.press('Enter');
  assert.notEqual(await disclosure.getAttribute('open'),null,'A real evidence reading state is open before History');
  await page.locator('#drawer-inner').evaluate(n=>{n.scrollTop=Math.min(120,Math.max(0,n.scrollHeight-n.clientHeight));});
  if(width<768)await page.locator('[data-mobile-view=graph]').click();
  const before=await snapshot(page);
  if(state==='failed')await page.route('**/api/explore',route=>route.fulfill({status:503,json:{error:'History temporarily unavailable'}}));
  await page.locator('#workspace-history').click();
  await page.locator(state==='ready'?'.history-row':'#history-retry').first().waitFor();
  const geometry=await page.locator('#history-return').evaluate(n=>{
   const r=n.getBoundingClientRect();
   const hits=[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>{const px=r.x+r.width*x,py=r.y+r.height*y;return{x:px,y:py,hit:n.contains(document.elementFromPoint(px,py))};}));
   const others=[...document.querySelectorAll('#git-history header input,#git-history .history-heading,#git-history header summary')].map(e=>{
    const b=e.getBoundingClientRect();return{tag:e.tagName,box:b.toJSON(),intersection:Math.max(0,Math.min(b.right,r.right)-Math.max(b.left,r.left))*Math.max(0,Math.min(b.bottom,r.bottom)-Math.max(b.top,r.top))};
   });
   return{button:r.toJSON(),hits,others};
  });
  await page.screenshot({path:`${out}/${width}-${state}.png`,fullPage:true});
  // Click near the bottom edge: this must be a painted, reachable control.
  const b=geometry.button;await page.mouse.click(b.x+b.width/2,b.bottom-2);
  await page.locator('#git-history').waitFor({state:'detached'});
  const after=await snapshot(page);
  const checks={height:b.height>=44,onScreen:b.left>=0&&b.right<=width&&b.top>=0&&b.bottom<=1000,
   hits:geometry.hits.every(p=>p.hit),overlap:geometry.others.every(p=>p.intersection===0),restored:JSON.stringify(before)===JSON.stringify(after),errors:errors.length===0};
  results.push({width,state,geometry,before,after,checks,errors});
  for(const [key,pass] of Object.entries(checks))if(!pass)failures.push(`${width}/${state}: ${key}`);
  console.log(JSON.stringify({width,state,height:b.height,checks}));
 }finally{await page.close();await app.cleanup();}
}}finally{await browser.close();await writeFile(out+'/geometry.json',JSON.stringify({browser:'Chromium',phase,results,failures},null,2));}
assert.deepEqual(failures,[]);
