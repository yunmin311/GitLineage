/** Offline acceptance: independent nodes, ports, paging and retained camera/selection. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtureServer,A} from './fixture-server.ts';
const out=new URL('../../artifacts/graph-expansion/',import.meta.url).pathname;await mkdir(out,{recursive:true});
async function checkPorts(page:any){
 const routes=await page.evaluate(()=>{
  const cards=[...document.querySelectorAll<SVGGraphicsElement>('#canvas .bundle-card-box, #canvas .node-box')].map(n=>({b:n.getBBox(),id:n.closest<SVGGElement>('.node')?.dataset.nodeId||''}));
  const failures:string[]=[];
  for(const path of document.querySelectorAll<SVGPathElement>('.edge-group .edge-line')){
   const owner=path.closest<SVGGElement>('.edge-group')!,source=owner.dataset.source!,target=owner.dataset.target!,len=path.getTotalLength();
   const onBoundary=(id:string,p:DOMPoint)=>cards.some(({b,id:own})=>own===id&&p.x>=b.x-.5&&p.x<=b.x+b.width+.5&&p.y>=b.y-.5&&p.y<=b.y+b.height+.5&&(Math.min(Math.abs(p.x-b.x),Math.abs(p.x-b.x-b.width),Math.abs(p.y-b.y),Math.abs(p.y-b.y-b.height))<1));
   if(!onBoundary(source,path.getPointAtLength(0))||!onBoundary(target,path.getPointAtLength(len)))failures.push('endpoint '+owner.dataset.relationshipId);
   for(let d=8;d<len-8;d+=8){const p=path.getPointAtLength(d);if(cards.some(({b,id})=>id!==source&&id!==target&&p.x>b.x+1&&p.x<b.x+b.width-1&&p.y>b.y+1&&p.y<b.y+b.height-1)){failures.push('crossing '+owner.dataset.relationshipId);break;}}
  }
  return failures;
 });assert.deepEqual(routes,[],'Every canonical edge uses entity ports and avoids unrelated nodes');
}
const app=await fixtureServer({phaseDelayMs:0});const browser=await chromium.launch();const results=[];
try{for(const width of [1920,1280,390,430]){
const page=await browser.newPage({viewport:{width,height:width<768?932:1080},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(app.url+'/'+A);await page.locator('.bundle-card').first().waitFor();
await page.locator('#zoom-fit').click();await page.screenshot({path:out+`${width}-before.png`});
const groups=page.locator('.bundle-card');const group=groups.filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
const camera=await page.locator('#canvas').getAttribute('viewBox');await group.focus();await page.keyboard.press('Enter');
assert.equal(await page.locator('#canvas').getAttribute('viewBox'),camera,'Expansion retains camera');
assert.ok(await page.locator('.aggregate-member').count()>0);
const geometry=await page.evaluate(()=>{
const cards=[...document.querySelectorAll<SVGGraphicsElement>('#canvas .bundle-card-box, #canvas .node-box')].map(n=>{const b=n.getBBox();return {kind:n.classList.contains('bundle-card-box')?'group':'node',x:b.x,y:b.y,w:b.width,h:b.height};});
return{cards,rows:document.querySelectorAll('#canvas .plate-row').length,ctm:document.querySelector<SVGSVGElement>('#canvas')!.getScreenCTM()!.toString(),stage:document.querySelector('#canvas')!.getBoundingClientRect().toJSON()};});
assert.ok(geometry.cards.filter(b=>b.kind==='group').every(b=>b.h<=110&&b.w<=280),'Groups must stay independent compact nodes, never contain members');
assert.equal(geometry.rows,0,'No file/member tables in graph groups');
for(let i=0;i<geometry.cards.length;i++)for(let j=i+1;j<geometry.cards.length;j++){const a=geometry.cards[i]!,b=geometry.cards[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'Independent nodes never overlap');}
await checkPorts(page);
await group.locator('.aggregate-focus').focus();await page.keyboard.press('Enter');if(width>=768)await page.locator('#zoom-fit').click();await page.evaluate(()=> (document.activeElement as HTMLElement)?.blur());await page.screenshot({path:out+`${width}-after.png`});
const first=page.locator('.aggregate-member').first();const selected=await first.getAttribute('data-node-id');await first.locator('.node-hit').click({force:true});
if(width<768)await page.locator('#mobile-evidence-back').click();
const retained=await page.locator('#canvas').getAttribute('viewBox');const second=groups.filter({hasNot:page.locator('.bundle-card-count',{hasText:'nebula_app'})}).first();await second.focus();await page.keyboard.press('Enter');
assert.equal(await page.locator('.bundle-card[aria-expanded=true]').count(),2,'Two branches actually expanded');
assert.equal(await page.locator('#canvas').getAttribute('viewBox'),retained,'Multi expansion retains focal point');assert.equal(await page.locator('.node.is-selected').getAttribute('data-node-id'),selected,'Selection retained');
await checkPorts(page);await page.locator('#zoom-fit').click();await page.screenshot({path:out+`${width}-multiple.png`});
const visited=new Set<string>();for(let round=0;round<30;round++){
for(const id of await page.locator('.aggregate-member').evaluateAll(ns=>ns.filter(n=>(n as HTMLElement).dataset.aggregateKey).map(n=>(n as HTMLElement).dataset.nodeId!)))visited.add(id);
const next=group.locator('.aggregate-next');if(await next.getAttribute('aria-disabled')==='true')break;await next.focus();await page.keyboard.press('Enter');}
assert.ok(visited.size>=45,'Large dependency collection reachable in bounded batches');assert.ok(await page.locator('.aggregate-member').count()<=13,'Bounded members across two expanded groups');
assert.deepEqual(errors,[]);results.push({width,geometry,visited:visited.size,status:'PASS'});await page.close();
}await writeFile(out+'geometry.json',JSON.stringify(results,null,2));console.log('PASS independent groups, disjoint member nodes, bounded exploration, camera and selection continuity');}finally{await browser.close();await app.cleanup();}
