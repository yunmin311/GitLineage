import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtureServer,A,B,D} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
// Capture labels never bypass assertions in the release gate.
const out='artifacts/site-release/after';
await mkdir(out,{recursive:true});const browser=await chromium.launch(),results=[];
try{for(const width of [1920,1280,430,390]){
 const fixture=unifiedFixture(),app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:fixture.transport});
 const p=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768});p.setDefaultTimeout(15000);const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 const surfaces:unknown[]=[];
 async function capture(name:string){
  const geometry=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
   reading:[...document.querySelectorAll('#landing,#drawer-inner,.history-list,.history-detail')].filter(n=>n.getClientRects().length).map(n=>({id:n.id,top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight})),
   controls:[...document.querySelectorAll('button:focus-visible,summary:focus-visible,input:focus-visible')].map(n=>({tag:n.tagName,box:n.getBoundingClientRect().toJSON(),outline:getComputedStyle(n).outlineStyle}))}));
  assert.ok(geometry.scroll<=width,`${name}: no horizontal overflow`);assert.deepEqual(errors,[],`${name}: no page errors`);
  surfaces.push({name,...geometry});await p.screenshot({path:`${out}/${width}-${name}.png`,fullPage:true});
 }
 try{
 await p.goto(app.url);await p.locator('.lab-map').waitFor();assert.equal(await p.locator('.lab-picker').count(),0);assert.equal(await p.locator('.lab-open').getAttribute('href'),'#repo-input');await p.waitForTimeout(350);await capture('landing');
 const landingPages=await p.locator('#landing').evaluate(n=>Math.ceil(n.scrollHeight/Math.max(1,n.clientHeight-100)));
 for(let tile=1;tile<landingPages;tile++){await p.locator('#landing').evaluate((n,t)=>{n.scrollTop=t*(n.clientHeight-100);},tile);await p.waitForTimeout(100);await capture('landing-scroll-'+tile);}
 await p.locator('#landing').evaluate(n=>{n.scrollTop=0;});
 const toggle=p.locator('.hero-trace-toggle').first();await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await p.locator('#repo-input').focus();await p.keyboard.press('Tab');assert.ok(await p.locator('#submit').evaluate(n=>n===document.activeElement&&getComputedStyle(n).outlineStyle!=='none'),'Landing input leads to a visibly focused submit action');
 await p.route('**/api/analysis/'+B.toLowerCase(),route=>route.fulfill({status:202,json:{jobId:'continuity',status:'collecting',statusUrl:'/api/analysis/jobs/continuity',retryAfterMs:1500}}));
 await p.route('**/api/analysis/jobs/continuity',route=>route.fulfill({json:{jobId:'continuity',status:'collecting',repository:B}}));
 await p.goto(app.url+'/'+B+'?tracer-test=1');await p.locator('#analysis:not([hidden]) .an-plabel.is-now').waitFor();await p.locator('.an-obj').evaluate(n=>{for(const a of n.getAnimations())a.finish();});await capture('analysis');
 await p.evaluate(()=>window.__setPhaseForTest?.('validating'));await p.locator('.an-obj').evaluate(n=>{for(const a of n.getAnimations())a.pause();});
 await p.emulateMedia({reducedMotion:'reduce'});
 await p.waitForFunction(()=>document.querySelector('.an-obj')!.getAnimations().length===0,undefined,{timeout:1000});
 await p.evaluate(()=>window.__setPhaseForTest?.('publishing'));
 const analysisMotion=await p.locator('#analysis').evaluate(n=>n.getAnimations({subtree:true}).map(a=>({target:(a.effect as KeyframeEffect).target instanceof Element?((a.effect as KeyframeEffect).target as Element).className:'',timing:a.effect?.getComputedTiming()})));
 assert.deepEqual(analysisMotion,[],'Reduced Motion settles Analysis immediately');
 await p.emulateMedia({reducedMotion:'no-preference'});
 const audit=await browser.newPage({viewport:{width,height:1000}});let semantics;
 try{await audit.goto(app.url+'/'+D);await audit.locator('#canvas .node').first().waitFor();
 const {data:canonicalView}=await (await audit.request.get(app.url+'/api/view/'+D)).json();
 await audit.goto(app.url+'/'+D+'?edge='+encodeURIComponent(canonicalView.edges[0].id));await audit.locator('#canvas .edge-line').first().waitFor({state:'attached'});
 semantics=await audit.evaluate(()=>{
  const sheet=[...document.styleSheets].find(s=>s.href?.endsWith('/site.css'))!;
  const read=()=>({tokens:['--verified','--verified-wash','--declared','--declared-wash','--detected','--detected-wash'].map(t=>[t,getComputedStyle(document.querySelector('#explorer')!).getPropertyValue(t).trim()]),
   edges:[...document.querySelectorAll('#canvas .edge-line,#canvas .plate-row-status')].map(n=>({class:n.getAttribute('class'),stroke:getComputedStyle(n).stroke,fill:getComputedStyle(n).fill}))});
  const accepted=read();sheet.disabled=true;const canonical=read();sheet.disabled=false;return{accepted,canonical};
 });}finally{await audit.close();}
 assert.deepEqual(semantics.accepted,semantics.canonical,'Context pigments do not recolor canonical evidence statuses');assert.ok(semantics.accepted.edges.length>0,'Canonical painted edges are present');
 await p.goto(app.url+'/'+A);await p.locator('#canvas .node').first().waitFor();await p.waitForTimeout(1000);const camera=await p.locator('#canvas').getAttribute('viewBox');
 if(width<768)await p.locator('#mobile-nav [data-mobile-view=relations]').click();await p.waitForTimeout(350);await capture('navigation');if(width<768)assert.equal(await p.locator('.mobile-family>summary').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(220, 232, 241)','mobile relationship disclosures use shared grammar');
 if(width<768){await p.locator('#mobile-relations details').evaluateAll(ns=>ns.forEach(n=>(n as HTMLDetailsElement).open=true));await p.locator('.mobile-relation-evidence').first().click();}
 else await p.locator('#canvas .node.is-subject .node-hit').click();
 await p.locator('#drawer-inner .d-pair,#drawer-inner .d-head').first().waitFor();await p.waitForTimeout(350);await capture('inspector');
 if(width<768)await p.locator('[data-mobile-view=relations]').click();
 const selectionUrl=p.url();
 await p.locator('#workspace-history').click();await p.locator('.history-row').first().waitFor();await p.waitForTimeout(350);await capture('history');
 const toolbar=await p.locator('#git-history header').evaluate(n=>({height:n.getBoundingClientRect().height,bg:getComputedStyle(n).backgroundColor}));
 {assert(toolbar.height<=(width<768?120:68),`compact history toolbar ${width}: ${toolbar.height}`);assert.equal(toolbar.bg,'rgb(220, 232, 241)','History uses the shared blue identity surface');}
 await p.locator('.history-row').first().click();await p.locator('.history-detail-section').first().waitFor();await p.waitForTimeout(350);await capture('history-detail');
 if(width<768)await p.locator('#history-list-return').click();const chooser=p.locator('.history-branch-picker');await chooser.locator('summary').click();await p.keyboard.press('Escape');assert.equal(await chooser.getAttribute('open'),null);
 await p.locator('#history-return').click();await p.waitForTimeout(400);assert.equal(await p.locator('#canvas').getAttribute('viewBox'),camera);assert.equal(p.url(),selectionUrl,'History retains selected object/relationship and navigation URL');
 if(width<768)await p.locator('#mobile-nav [data-mobile-view=relations]').click();await p.locator('#workspace-candidates').click();await p.locator('#deep-repository').fill(A);await p.locator('#deep-search-submit').click();await p.locator('#deep-candidates input').last().waitFor();await p.locator('#deep-candidates input').last().check();await p.locator('.deep-candidate').last().scrollIntoViewIfNeeded();await p.waitForTimeout(350);await capture('discovery');
 const candidate=await p.locator('.deep-candidate.is-selected').first().evaluate(n=>({left:getComputedStyle(n).borderLeftWidth,right:getComputedStyle(n).borderRightWidth,pseudo:getComputedStyle(n,'::before').content}));{assert.equal(candidate.left,candidate.right,'No decorative vertical rule');assert(['none','normal'].includes(candidate.pseudo),'No selected-card pseudo stripe');}
 await p.locator('#deep-source-preview').click();await p.locator('#deep-files input[value="src/modules/main.ts"]').first().waitFor();await p.locator('#deep-files input[value="src/modules/main.ts"]').first().scrollIntoViewIfNeeded();await p.waitForTimeout(350);await capture('files');
 await p.emulateMedia({reducedMotion:'reduce'});const summary=p.locator('.deep-limits > summary');await summary.focus();await p.keyboard.press('Enter');await p.keyboard.press('Enter');assert(await summary.evaluate(n=>n===document.activeElement));
 assert.equal(await p.locator('#deep-dialog').evaluate(n=>n.getAnimations({subtree:true}).length),0,'Reduced Motion settles Discovery immediately');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);results.push({width,surfaces,semantics,toolbar,candidate,keyboard:true,returnCamera:true,reducedMotion:true,errors});console.log('PASS site continuity',width);
 }finally{await p.close();await app.cleanup();}
}}finally{await browser.close();await writeFile(out+'/checks.json',JSON.stringify({transport:'offline fixture',browser:'Chromium',physicalDevice:false,results},null,2));}
