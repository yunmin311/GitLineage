import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A,D,E} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out=resolve('artifacts/unified-workspace/stress');await mkdir(out,{recursive:true});
const browser=await chromium.launch();const data=[];
try{for(const width of [1920,390]){
 const f=unifiedFixture(true),app=await fixtureServer({publicExploration:true,phaseDelayMs:0,explorationCooldownMs:0,explorationTransport:f.transport});
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const locate=async(label:string)=>{if(width<768)await page.locator('[data-mobile-view=relations]').click();else if(await page.locator('#rail-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#rail-toggle').click();const input=page.locator('input[aria-label="Find explored objects"]');await input.fill(label);await page.locator('.unified-search-results').getByRole('button',{name:label,exact:true}).click();if(width<768)await page.locator('[data-mobile-view=evidence]').click();};
 try{
  await page.goto(app.url+'/'+A);await page.locator('#workspace-structure').waitFor();await page.locator('#workspace-structure').click();await page.locator('.kind-directory').first().waitFor({state:'attached'});
  await locate('src');await page.locator('#workspace-expand').click();await page.waitForFunction(()=>[...document.querySelectorAll('.kind-directory')].some(n=>n.getAttribute('aria-label')==='directory: modules'));
  await locate('modules');await page.locator('#workspace-expand').click();const cap=width<768?5:8;await page.waitForFunction(n=>document.querySelector('#drawer-inner')?.textContent?.includes(`${n} of 129`),cap);
  const initial=await page.locator('.unified-node .node-box').evaluateAll(ns=>ns.map(n=>({id:n.parentElement!.getAttribute('data-node-id'),x:n.getAttribute('x'),y:n.getAttribute('y')})));
  await page.locator('#workspace-expand').click();await page.waitForFunction(n=>document.querySelector('#drawer-inner')?.textContent?.includes(`${n} of 129`),cap*2);
  const grown=await page.locator('.unified-node .node-box').evaluateAll(ns=>ns.map(n=>({id:n.parentElement!.getAttribute('data-node-id'),x:n.getAttribute('x'),y:n.getAttribute('y')})));for(const n of initial)assert.deepEqual(grown.find(p=>p.id===n.id),n);assert.ok(grown.length<30,'Large tree never floods the canvas');
  if(width<768)await page.locator('[data-mobile-view=graph]').click();else await page.locator('#zoom-fit').click();await page.screenshot({path:resolve(out,`${width}-large-tree.png`)});
  const boxes=await page.locator('#canvas .node-box').evaluateAll(ns=>ns.map(n=>{const b=(n as SVGGraphicsElement).getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};}));for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i]!,b=boxes[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);}
  if(width<768){await locate('modules');await page.locator('[data-mobile-view=graph]').click();const camera=await page.locator('#canvas').getAttribute('viewBox');const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:530}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:205,y:560}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.notEqual(await page.locator('#canvas').getAttribute('viewBox'),camera,'Native touch pans this world');await cdp.detach();}

  if(await page.locator('[data-perspective=dependencies]').getAttribute('aria-pressed')!=='true')await page.locator('[data-perspective=dependencies]').click();
  for(const label of ['nebula_app','mobile/link']){
    const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:label})});
    if(await group.getAttribute('aria-expanded')!=='true'){await group.focus();await page.keyboard.press('Enter');}else{await group.locator('.aggregate-more').focus();await page.keyboard.press('Enter');}
  }
  assert.ok(await page.locator('.aggregate-member').count()>5);
  assert.ok(await page.locator('.unified-node').count()>10,'Dependency filtering retains the expanded tree world');
  const mixed=await page.locator('#canvas .node-box,#canvas .bundle-card-box').evaluateAll(ns=>ns.map(n=>{const b=(n as SVGGraphicsElement).getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};}));
  for(let i=0;i<mixed.length;i++)for(let j=i+1;j<mixed.length;j++){const a=mixed[i]!,b=mixed[j]!;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'Mixed canonical and display neighborhoods do not overlap');}
  if(width>=768)await page.locator('#zoom-fit').click();
  await page.screenshot({path:resolve(out,`${width}-mixed-neighborhoods.png`)});
  for(const label of ['deep','one','two','three','four','five','six']){await locate(label);await page.locator('#workspace-expand').click();await page.waitForFunction(()=>document.querySelector('#workspace-status')?.textContent?.includes('Objects added'));}
  await locate('leaf.ts');assert.ok(await page.locator('.kind-directory').count()>=10,'Exploration continues beyond four levels');
  if(width<768){await page.locator('[data-mobile-view=graph]').click();const pair=await page.locator('.unified-node').evaluateAll(ns=>ns.filter(n=>['directory: six','file: leaf.ts'].includes(n.getAttribute('aria-label')??'')).map(n=>n.querySelector('.node-box')!.getBoundingClientRect().toJSON()));assert.equal(pair.length,2);assert.ok(pair.every(b=>b.height>=44&&b.x>=0&&b.right<=390&&b.y>300&&b.bottom<850),'Deep focus retains the parent directory and readable file in one phone neighborhood');}else await page.locator('#zoom-fit').click();await page.screenshot({path:resolve(out,`${width}-deep-structure.png`)});
  await page.goto(app.url+'/'+D);await page.locator('.edge-group.fam-ancestry').first().waitFor({state:'attached'});await page.locator('#workspace-history').waitFor();assert.deepEqual(await page.locator('[data-perspective]').evaluateAll(ns=>ns.map(n=>n.getAttribute('aria-pressed'))),['true','true','true']);const ids=await page.locator('#canvas .node').evaluateAll(ns=>ns.map(n=>n.getAttribute('data-node-id')));assert.equal(new Set(ids).size,ids.length,'Shared objects keep one identity');assert.equal(await page.locator('#canvas').count(),1);await page.screenshot({path:resolve(out,`${width}-fork.png`)});
  await page.goto(app.url+'/'+E);await page.locator('#workspace-history').waitFor();await page.locator('.graph-provenance-empty').waitFor();assert.match(await page.locator('.graph-provenance-empty').innerText(),/No recorded ancestry/);assert.equal(await page.locator('#canvas .node').count(),1);await page.screenshot({path:resolve(out,`${width}-no-lineage.png`)});
  assert.deepEqual(errors,[]);data.push({width,largeTreeEntries:129,initial:initial.length,grown:grown.length,boxes,status:'PASS'});
 }finally{await page.close();await app.cleanup();}
}await writeFile(resolve(out,'geometry.json'),JSON.stringify(data,null,2));console.log('PASS large structure: bounded growth, preserved coordinates, no overlap, native touch pan; fork and no-lineage fixtures on the unified shell.');
}finally{await browser.close();}
