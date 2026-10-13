/** Main-canvas ownership, port geometry and selection continuity; offline only.
 * LAYOUT_BASELINE=1 serves f80ee9c9's client in memory to reproduce the defect. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {resolve,relative} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const baseline=process.env.LAYOUT_BASELINE==='1';
const out=resolve('artifacts/branch-layout',baseline?'baseline':'after');await mkdir(out,{recursive:true});
let oldClient:string|undefined;
if(baseline){const result=await build({entryPoints:['src/web/client/app.js'],bundle:true,write:false,format:'esm',plugins:[{name:'baseline-read-only',setup(b){b.onLoad({filter:/src\/web\/client\/.*\.(mjs|js)$/},args=>({contents:execFileSync('git',['show','f80ee9c9:'+relative(process.cwd(),args.path)],{encoding:'utf8'}),loader:'js'}));}}]});oldClient=result.outputFiles[0]!.text;}
const app=await fixtureServer({publicExploration:true,phaseDelayMs:0,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
const browser=await chromium.launch();const evidence=[];
try{for(const width of [1920,430,390]){
 const page=await browser.newPage({viewport:{width,height:width<768?932:1080},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});
 if(oldClient)await page.route('**/assets/app.js',route=>route.fulfill({contentType:'text/javascript',body:oldClient}));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url+'/'+A);await page.locator('#workspace-history').waitFor();
 for(const name of ['nebula_app','nebula_terminal','mobile/link']){const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:name})});if(await group.getAttribute('aria-expanded')!=='true')await group.press('Enter');}
 if(width===1920)await page.locator('#zoom-fit').click();
 await page.screenshot({path:resolve(out,`${width}-multiple.png`)});
 const geometry=await page.locator('#canvas').evaluate(svg=>{
  const boxes=[...svg.querySelectorAll<SVGGraphicsElement>('.node-box,.bundle-card-box')].map(n=>({id:n.parentElement!.getAttribute('data-node-id')||'bundle:'+n.parentElement!.getAttribute('data-bundle-key'),box:n.getBBox(),screen:n.getBoundingClientRect().toJSON()}));
  const bands=[...svg.querySelectorAll<SVGGraphicsElement>('.bundle-card')].map(g=>{const key=g.getAttribute('data-bundle-key');const members=[...svg.querySelectorAll<SVGGraphicsElement>('.aggregate-member')].filter(n=>n.getAttribute('data-aggregate-key')===key).map(n=>n.querySelector<SVGGraphicsElement>('.node-box')!.getBBox());return{key,anchor:(()=>{const b=g.querySelector<SVGGraphicsElement>('.bundle-card-box')!.getBBox();return{x:b.x,y:b.y,w:b.width,h:b.height};})(),members:members.map(b=>({x:b.x,y:b.y,w:b.width,h:b.height}))};});
  const routes=[...svg.querySelectorAll<SVGGraphicsElement>('.group-navigation,.group-navigation-root')].map(g=>{const p=g instanceof SVGPathElement?g:g.querySelector<SVGPathElement>('path')!;return{source:g.getAttribute('data-navigation-source'),target:g.getAttribute('data-navigation-target'),samples:Array.from({length:65},(_,i)=>{const q=p.getPointAtLength(p.getTotalLength()*i/64);return{x:q.x,y:q.y};})};});
  return{boxes:boxes.map(b=>({...b,box:{x:b.box.x,y:b.box.y,w:b.box.width,h:b.box.height}})),bands,routes,ctm:(svg as SVGSVGElement).getScreenCTM()?.toString()};
 });
 for(const b of geometry.boxes)if(b.id&&!b.id.startsWith('bundle:')&&b.id!=='repo:github:kuddev/pebrel')assert.ok(geometry.routes.some(r=>r.target===b.id),'Every expanded member has a painted connection');
 const bands=geometry.bands.filter(b=>b.members.length).sort((a,b)=>a.anchor.y-b.anchor.y);
 if(width===1920)for(let i=0;i<bands.length-1;i++)assert.ok(Math.max(...bands[i]!.members.map(b=>b.y+b.h))<Math.min(...bands[i+1]!.members.map(b=>b.y)),'Actual member neighborhoods must not interleave');
 for(let i=0;i<geometry.boxes.length;i++)for(let j=i+1;j<geometry.boxes.length;j++){const a=geometry.boxes[i]!.box,b=geometry.boxes[j]!.box;assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'Actual painted nodes do not overlap');}
 for(const r of geometry.routes)for(const box of geometry.boxes)if(box.id!==r.source&&box.id!==r.target)for(const p of r.samples){const b=box.box;assert.ok(p.x<=b.x||p.x>=b.x+b.w||p.y<=b.y||p.y>=b.y+b.h,'Painted relation clears every unrelated node');}
 await page.locator('.node.is-subject').press('Enter');assert.ok(await page.locator('.group-navigation').count()>0,'Selecting the trunk preserves its grouping links');assert.equal(await page.locator('.edge-group.fam-dependency').count(),0,'Trunk selection must not replace branches with a dependency hairball');
 if(width<768){
  await page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_terminal'})}).locator('.aggregate-focus').press('Enter');
  await page.locator('#mobile-nav [data-mobile-view=graph]').click();
  const focus=await page.locator('#canvas').evaluate(svg=>{
   const node=svg.querySelector<SVGGraphicsElement>('.aggregate-member.is-selected')!;
   const line=[...svg.querySelectorAll<SVGGraphicsElement>('.group-navigation')].find(g=>g.dataset.navigationTarget===node.dataset.nodeId&&g.dataset.navigationSource==='bundle:'+node.dataset.aggregateKey)!.querySelector<SVGGraphicsElement>('path')!;
   return{node:node.querySelector('.node-box')!.getBoundingClientRect().toJSON(),line:line.getBoundingClientRect().toJSON(),stage:svg.getBoundingClientRect().toJSON()};
  });
  assert.ok(focus.node.height>=44,'Focused mobile member retains a real touch target');
  assert.ok(focus.line.left>=focus.stage.left&&focus.line.right<=focus.stage.right,'The selected member connection fits horizontally with its parent');
  await page.screenshot({path:resolve(out,`${width}-local-focus.png`)});
 }
 evidence.push({width,...geometry,errors});assert.deepEqual(errors,[]);await page.close();
}await writeFile(resolve(out,'geometry.json'),JSON.stringify(evidence,null,2));console.log('PASS actual branch ownership, node clearance, routed pixels and repository selection at 1920 / 430 / 390');
}finally{await browser.close();await app.cleanup();}
