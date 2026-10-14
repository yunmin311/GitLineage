/** Painted SVG regression for the shared-node port obstruction, not edge counts. */
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const moduleURL=async(file:string)=>'data:text/javascript;base64,'+Buffer.from(await readFile(file,'utf8')).toString('base64');
const routing=await moduleURL('src/web/client/lib/spatial.mjs'),fallback=await moduleURL('src/web/client/lib/connection-fallback.mjs');
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<svg id="scene" viewBox="-200 -200 1100 600" width="1100" height="600"></svg>');
 const result=await page.evaluate(async({routing,fallback})=>{
  const {spatialRoute}=await import(routing),{connectionFallback}=await import(fallback),svg=document.querySelector('#scene')!;
  const positions=new Map([['a',{x:0,y:0}],['b',{x:600,y:0}],['shared',{x:244,y:0}],['c',{x:600,y:150}]]);
  const edges=[{source:'a',target:'b'},{source:'a',target:'c'},{source:'shared',target:'b'},{source:'c',target:'shared'}];
  const probes=edges.map(edge=>{
   const route=spatialRoute(edge,positions);if(!route)return{edge,painted:false};
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',route.path);path.setAttribute('stroke','black');path.setAttribute('fill','none');svg.append(path);
   const length=path.getTotalLength(),samples=Array.from({length:Math.ceil(length)+1},(_,i)=>path.getPointAtLength(Math.min(i,length)));
   const hits=[...positions].filter(([id,p])=>samples.some(pt=>Math.abs(pt.x-p.x)<108-.1&&Math.abs(pt.y-p.y)<26-.1)).map(([id])=>id);
   const start=path.getPointAtLength(0),end=path.getPointAtLength(length);
   return{edge,painted:true,hits,start:{x:start.x,y:start.y},end:{x:end.x,y:end.y}};
  });
  // All exits sealed by real overlapping bounds: show inspectable gap, never an unsafe curve.
  const sealed=new Map([['a',{x:0,y:0}],['b',{x:600,y:0}],['blocker',{x:0,y:0,width:300,height:150}]]);
  const blocked=spatialRoute(edges[0],sealed);const counter=document.createElement('output');counter.id='selections';counter.textContent='0';document.body.append(counter);
  const badge=connectionFallback({...edges[0],label:'Declared dependency'},sealed,()=>{counter.textContent=String(Number(counter.textContent)+1)},{'data-relationship-id':'real-edge'});svg.append(badge);
  return{probes,blocked,badges:badge.querySelectorAll('rect').length,label:badge.getAttribute('aria-label')};
 },{routing,fallback});
 for(const probe of result.probes){assert.ok(probe.painted,JSON.stringify(probe.edge));assert.deepEqual(probe.hits,[],'Painted path clears every node, including its endpoints');}
 assert.equal(result.blocked,null);assert.equal(result.badges,2);assert.match(result.label!,/Connection obstructed.*a.*Declared dependency.*b/);
 await page.locator('[data-route-fallback]').focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('#selections').textContent(),'1','Keyboard opens actual relationship details');
 // The group spans two separated badges; its bounding-box centre is empty canvas.
 await page.locator('[data-route-fallback] rect').first().click();
 assert.equal(await page.locator('#selections').textContent(),'2','Pointer opens the same relationship');
 console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
