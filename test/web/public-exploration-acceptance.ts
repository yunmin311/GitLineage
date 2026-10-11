import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
import {cacheProof} from './cache-proof.ts';
import {validatePreviewExport} from '../../experiments/discovery-v2/preview-contract.ts';
const engine=process.env.PLAYWRIGHT_BROWSER??'chromium';if(!['chromium','webkit'].includes(engine))throw new Error('Unsupported browser');
const out=resolve('artifacts',engine==='webkit'?'public-exploration-webkit':'public-exploration');await mkdir(out,{recursive:true});const browser=await (engine==='webkit'?webkit:chromium).launch();const results=[];
try{
 for(const width of [390,430,1280,1920])for(const mode of ['structure','discovery']){
  const f=treeFixture();f.repos[0]!.files={'src/modules/main.ts':Buffer.from('export function map(values) { return values.map(value => value + 234); }\n'),'src/extra.ts':Buffer.from('export const extra = 123456;\n')};f.repos[3]!.files={'lib/core.ts':f.repos[0]!.files['src/modules/main.ts']!};f.rebuild();
  for(const [path,value] of f.routes)if(path.includes('/commits/')){const c=value as {commit:Record<string,unknown>};c.commit.author={name:'Fixture',date:'2026-10-11T00:00:00Z'};c.commit.message='Introduce module';}
  const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,explorationTransport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response(JSON.stringify([{name:'main',commit:{sha:f.repos[0]!.revision}}])):f.transport(url,init)});
  const page=await browser.newPage({viewport:{width,height:width<768?932:1080},hasTouch:width<768,isMobile:width<768,reducedMotion:'reduce'});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(app.url+'/'+A);await page.locator('#canvas .node-box').first().waitFor();await page.locator('#canvas .node-hit').first().click();
   const state=()=>page.locator('#canvas').evaluate(el=>{const c=(el as unknown as SVGSVGElement).getScreenCTM();const rect=(n:Element|null)=>{if(!n)return null;const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height] as const;};const stage=rect(document.querySelector('#stage'));const screenX=stage?stage[0]+stage[2]/2:0,screenY=stage?stage[1]+stage[3]/2:0;const point=new DOMPoint(screenX,screenY);const focal=c?point.matrixTransform(c.inverse()):null;return{viewBox:el.getAttribute('viewBox'),ctm:c?[c.a,c.b,c.c,c.d,c.e,c.f]:null,stage,selected:rect(document.querySelector('.node.is-selected .node-box')),focal:focal?[focal.x,focal.y]:null,url:location.href};});const before=await state(),cache=await cacheProof(app.fixtureCacheRoot);
   await page.locator('#deep-launch').click();await page.locator('#repository-workspace').waitFor({state:'visible'});
   if(mode==='structure'){
    await page.locator('#explore-repository').fill('root/example');await page.locator('#explore-load').click();await page.locator('.explore-tree').waitFor();await page.getByRole('button',{name:'src/',exact:true}).click();await page.getByRole('button',{name:'modules/',exact:true}).click();await page.getByRole('link',{name:'main.ts',exact:true}).waitFor();
    await page.screenshot({path:resolve(out,`${width}-structure.png`)});
    await page.locator('#repository-workspace').getByRole('button',{name:'History',exact:true}).click();await page.getByText('Introduce module',{exact:true}).waitFor();assert.match(await page.locator('#explore-content').innerText(),/Root within returned object/);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#explore-download').click()]);const saved=resolve(out,`${width}-history.json`);await download.saveAs(saved);const receipt=JSON.parse(await readFile(saved,'utf8'));assert.equal(receipt.commits[0].sha,f.repos[0]!.revision);assert.ok(receipt.receipt.usage.attempts<=24);assert.equal(receipt.lineageClaim,'none');
    await page.screenshot({path:resolve(out,`${width}-history.png`)});await page.locator('#explore-back').click();
   }else{
    await page.locator('#repository-workspace').getByRole('button',{name:'Deep Search',exact:true}).click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();await page.locator('#deep-candidates input').last().waitFor();await page.locator('#deep-candidates input').last().check();await page.locator('#deep-source-preview').click();await page.locator('#deep-files input[value="src/modules/main.ts"]').waitFor();await page.locator('#deep-files input[value="src/modules/main.ts"]').check();await page.locator('#deep-files input[value="src/extra.ts"]').uncheck();await page.locator('#deep-compare').click();await page.locator('#deep-download').waitFor();assert.match(await page.locator('#deep-results').innerText(),/100\.00%/);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-download').click()]);const saved=resolve(out,`${width}-comparison.json`);await download.saveAs(saved);const sidecar=JSON.parse(await readFile(saved,'utf8'));validatePreviewExport(sidecar);assert.equal(sidecar.probe.content.verification,'pending');assert.equal(sidecar.probe.content.lineageClaim,'none');
    await page.screenshot({path:resolve(out,`${width}-discovery.png`)});
    await page.locator('#deep-dialog').getByRole('button',{name:'Structure',exact:true}).click();assert.equal(await page.locator('#explore-repository').inputValue(),'root/example');await page.locator('#repository-workspace').getByRole('button',{name:'History',exact:true}).click();assert.equal(await page.locator('#explore-repository').inputValue(),'root/example');await page.locator('#repository-workspace').getByRole('button',{name:'Deep Search',exact:true}).click();assert.match(await page.locator('#deep-results').innerText(),/100\.00%/);
    await page.locator('#deep-dialog').getByRole('button',{name:'Candidates',exact:true}).click();await page.locator('#deep-layer-dialog .deep-layer-candidate').last().click();assert.match(await page.locator('#deep-inspection').innerText(),/Pinned similarity/);await page.locator('#deep-back').click();
   }
   assert.deepEqual(await state(),before);assert.deepEqual(await cacheProof(app.fixtureCacheRoot),cache);assert.deepEqual(errors,[]);
   results.push({width,mode,status:'PASS',canonicalUnchanged:true,graphState:before,mockGitHub:true});
  }finally{await page.close();await app.cleanup();}
 }
 await writeFile(resolve(out,'receipt.json'),JSON.stringify({browser:engine+' simulation; no physical device claim',results},null,2));console.log(JSON.stringify(results.map(({width,mode,status})=>({width,mode,status}))));
}finally{await browser.close();}
