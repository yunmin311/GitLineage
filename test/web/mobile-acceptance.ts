/** Actual production ViewGraphs + Chromium CDP touch simulation, not physical devices. */
import { chromium, webkit, type Page, type CDPSession } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixtureServer, A, B, C } from './fixture-server.ts';
import { relationGroups } from '../../src/web/client/lib/mobile.mjs';
import type { ViewGraph } from '../../src/web/view-model.ts';
const out=resolve('artifacts/mobile',process.env.MOBILE_PHASE??'after');
await mkdir(out,{recursive:true});
const app=await fixtureServer();const browser=await chromium.launch();
const checks:{name:string;ok:boolean;detail:unknown}[]=[];
const evidence:Record<string,unknown>={};const events:unknown[]=[];
function check(name:string,ok:boolean,detail:unknown=''){checks.push({name,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function measure(page:Page){return page.evaluate(()=>{
 const svg=document.querySelector<SVGSVGElement>('#canvas')!, c=svg.getScreenCTM()!,v=svg.viewBox.baseVal;
 const r=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect().toJSON();
 return {view:document.querySelector<HTMLElement>('#explorer-body')!.dataset.mobileView,stage:r('#stage'),nav:r('#mobile-nav'),hud:r('#viewport-hud'),subject:r('.node-box.is-subject'),
 ctm:[c.a,c.b,c.c,c.d,c.e,c.f],camera:svg.getAttribute('viewBox'),focal:[v.x+v.width/2,v.y+v.height/2],selection:new URL(location.href).searchParams.get('edge')||new URL(location.href).searchParams.get('node'),
 overflow:document.documentElement.scrollWidth>innerWidth,relationsScroll:document.querySelector('#mobile-relation-list')!.scrollTop,evidenceScroll:document.querySelector('#drawer-inner')!.scrollTop};
});}
async function touch(cdp:CDPSession,type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',points:{x:number;y:number;id?:number}[]){events.push({type,points});await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});}
async function scroll(page:Page,cdp:CDPSession,selector:string){const b=(await page.locator(selector).boundingBox())!;const x=b.x+b.width*.6,y=b.y+b.height-25;
 await touch(cdp,'touchStart',[{x,y}]);for(let i=1;i<=6;i++){await touch(cdp,'touchMove',[{x,y:y-i*Math.min(35,(b.height-50)/6)}]);await page.waitForTimeout(30);}await touch(cdp,'touchEnd',[]);await page.waitForTimeout(1200);}
try{
 for(const [width,height,repo] of [[390,844,A],[375,667,B],[430,932,C],[844,390,A]] as const){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
 const errors:string[]=[];const requests:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.method()+' '+r.url());});
 let view:ViewGraph|undefined;
 page.on('response',async r=>{if(r.url().includes('/api/view/')){const json=await r.json();view=json.data;}});
 await page.goto(`${app.url}/${repo}`);await page.locator('.node-box.is-subject').waitFor({timeout:60000});await page.evaluate(()=>document.fonts.ready);
 while(!view)await page.waitForTimeout(20);
 const label=`${width} ${repo}`;const cdp=await page.context().newCDPSession(page);const base=await measure(page);
 await page.screenshot({path:`${out}/${width}-graph.png`});
 check(`${label} navigation and opening subject reachable`,await page.locator('#mobile-nav').isVisible()&&base.subject.x>=0&&base.subject.right<=width&&base.subject.y>=base.stage.y&&base.subject.bottom<base.hud.y,base);
 check(`${label} primary controls 44px and no overflow`,await page.locator('#mobile-nav button, #zoom-fit, #search-btn').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.width>=43&&r.height>=43;}))&&!base.overflow);
 const x=base.stage.width/2,y=base.stage.y+Math.min(230,base.stage.height/2);
 await touch(cdp,'touchStart',[{x,y,id:1}]);for(let i=1;i<=5;i++)await touch(cdp,'touchMove',[{x:x+i*8,y:y-i*6,id:1}]);await touch(cdp,'touchEnd',[]);
 const pan=await measure(page);check(`${label} native single finger pan without selection`,pan.camera!==base.camera&&!pan.selection&&same(base.stage,pan.stage),{base,pan});
 // A two-finger pinch at a fixed midpoint. Inverse CTM measures its world anchor.
 const mx=width/2,my=base.stage.y+base.stage.height/2;
 const world=await page.evaluate(({x,y})=>{const c=document.querySelector<SVGSVGElement>('#canvas')!.getScreenCTM()!;const p=new DOMPoint(x,y).matrixTransform(c.inverse());return{x:p.x,y:p.y};},{x:mx,y:my});
 await touch(cdp,'touchStart',[{x:mx-45,y:my,id:1},{x:mx+45,y:my,id:2}]);
 for(let i=1;i<=5;i++)await touch(cdp,'touchMove',[{x:mx-45-i*7,y:my,id:1},{x:mx+45+i*7,y:my,id:2}]);
 await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);
 const pinch=await measure(page);const anchor=await page.evaluate(p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(document.querySelector<SVGSVGElement>('#canvas')!.getScreenCTM()!);return{x:q.x,y:q.y};},world);
 check(`${label} two-finger zoom anchored at true midpoint, no ghost click`,pinch.ctm[0]!>pan.ctm[0]!&&Math.hypot(anchor.x-mx,anchor.y-my)<1&&!pinch.selection,{world,screenMidpoint:{x:mx,y:my},anchor,pinch});
 await page.locator('#zoom-fit').click();const fitted=await measure(page);check(`${label} Fit restores phone camera`,same(fitted.camera,base.camera)&&fitted.ctm[0]===1);
 const node=await page.locator('.node-box.is-subject').boundingBox();await touch(cdp,'touchStart',[{x:node!.x+node!.width/2,y:node!.y+node!.height/2}]);await touch(cdp,'touchEnd',[]);
 await page.waitForTimeout(100);const selected=await measure(page);check(`${label} native tap opens real node Evidence`,selected.view==='evidence'&&selected.selection===view!.subject.id&&await page.locator('#drawer-inner').isVisible(),selected);
 await page.locator('#mobile-nav [data-mobile-view=graph]').click();check(`${label} Evidence return keeps camera and selection`,same((await measure(page)).camera,fitted.camera)&&(await measure(page)).selection===selected.selection);
 await page.locator('#mobile-nav [data-mobile-view=relations]').click();const list=await measure(page);
 const expected=relationGroups(view!);
 const ids=await page.locator('[data-relation-id]').evaluateAll(es=>es.map(e=>(e as HTMLElement).dataset.relationId!).sort());
 check(`${label} complete canonical member reachability`,same(ids,view!.edges.map(e=>e.id).sort())&&new Set(ids).size===ids.length&&(repo!==A||ids.length===97),{actual:ids.length,canonical:view!.edges.length});
 check(`${label} real family/group and distinct counts`,await page.locator('.mobile-family').count()===expected.length&&await page.locator('.mobile-group').count()===expected.reduce((n,f)=>n+f.groups.length,0),expected.map(f=>({family:f.family,count:f.count,groups:f.groups.map(g=>({label:g.label,relationships:g.edges.length,evidence:g.evidenceCount}))})));
 for(const summary of await page.locator('.mobile-family > summary').all())await summary.click();
 for(const summary of await page.locator('.mobile-group > summary').all())await summary.click();
 await scroll(page,cdp,'#mobile-relation-list');const listScroll=await measure(page);
 check(`${label} Relations native scroll owns gesture`,listScroll.relationsScroll>0&&same(list.camera,listScroll.camera)&&listScroll.view==='relations',{list,listScroll});
 await page.locator('#mobile-nav [data-mobile-view=graph]').click();await page.locator('#mobile-nav [data-mobile-view=relations]').click();check(`${label} list expansion and scroll restored`,(await measure(page)).relationsScroll===listScroll.relationsScroll&&await page.locator('.mobile-group').evaluateAll(es=>es.every(e=>(e as HTMLDetailsElement).open)));
 // Pick an actual multi-record relation, read every inlined record with actual locators/text.
 const edge=[...view!.edges].sort((a,b)=>(view!.evidenceByRelationship[b.id]?.length??0)-(view!.evidenceByRelationship[a.id]?.length??0))[0]!;
 const actualRow=page.locator(`[data-relation-id="${edge.id}"]`);
 await actualRow.locator('.mobile-relation-evidence').scrollIntoViewIfNeeded();
 const beforeReadingList = (await measure(page)).relationsScroll;
 await actualRow.locator('.mobile-relation-evidence').click();const reading=await measure(page);
 const text=await page.locator('#drawer-inner').innerText();const cards=view!.evidenceByRelationship[edge.id]??[];
 check(`${label} exact relationship/status/all provided evidence readable`,reading.selection===edge.id&&text.includes(edge.relationshipType)&&text.includes(edge.status)&&cards.every(c=>(!c.locator||text.includes(c.locator))&&(!c.observedText||text.includes(c.observedText)))&&await page.locator('.d-card').count()===cards.length,{id:edge.id,records:cards.length,total:edge.evidenceCount,truncated:edge.evidenceTruncated});
 await page.screenshot({path:`${out}/${width}-evidence.png`});
 await scroll(page,cdp,'#drawer-inner');const readScroll=await measure(page);
 check(`${label} Evidence native scroll never moves graph`,readScroll.evidenceScroll>0&&same(reading.camera,readScroll.camera)&&readScroll.selection===edge.id,{reading,readScroll});
 check(`${label} evidence heading/back/close remain accessible`,await page.locator('#mobile-evidence-heading button').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.height>=44&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})));
 await page.locator('#mobile-evidence-back').click();check(`${label} reading return restores Relations position`,(await measure(page)).relationsScroll===beforeReadingList&&(await measure(page)).selection===edge.id);
 await page.locator('#mobile-nav [data-mobile-view=evidence]').click();check(`${label} Evidence exact scroll restored`,(await measure(page)).evidenceScroll===readScroll.evidenceScroll);
 await page.goBack();await page.waitForTimeout(100);check(`${label} browser Back restores view/selection/camera without analyze`,(await measure(page)).view==='relations'&&(await measure(page)).selection===edge.id&&same((await measure(page)).camera,reading.camera));
 await page.locator('#mobile-relation-query').fill(view!.nodes.find(n=>n.id===edge.target)!.label);
 check(`${label} search matches real relationship/entity`,await actualRow.isVisible());
 await page.screenshot({path:`${out}/${width}-relations.png`});
 await actualRow.locator('.mobile-locate').click();const located=await measure(page);
 check(`${label} View in Graph locates retained target`,located.view==='graph'&&located.selection===edge.id&&located.camera!==null&&await page.locator('[data-mobile-located]').count()===1,located);
 const hit=await page.evaluate(()=>{
   const stage=document.querySelector('#stage')!.getBoundingClientRect(), bottom=document.querySelector('#viewport-hud')!.getBoundingClientRect().top;
   for(const e of document.querySelectorAll<SVGGraphicsElement>('.plate-row-hit, .edge-hit')) {
     const owner=e.closest<HTMLElement>('[data-edge-id], [data-relationship-id]')!;
     const r=e.getBoundingClientRect();let points=[{x:r.x+r.width/2,y:r.y+r.height/2}];
     if(e instanceof SVGPathElement) points=[.25,.5,.75].map(t=>{const p=e.getPointAtLength(e.getTotalLength()*t);const q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM()!);return{x:q.x,y:q.y};});
     for(const p of points) if(p.x>0&&p.x<innerWidth&&p.y>stage.top&&p.y<bottom&&owner.contains(document.elementFromPoint(p.x,p.y))) return {...p,id:owner.dataset.edgeId||owner.dataset.relationshipId};
   }return null;
 });
 if(hit){await touch(cdp,'touchStart',[{x:hit.x,y:hit.y}]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);}
 check(`${label} native painted relationship hit opens corresponding Evidence`,!!hit&&(await measure(page)).view==='evidence'&&(await measure(page)).selection===hit.id,hit);
 await page.locator('#mobile-nav [data-mobile-view=graph]').click();
 await page.locator('#search-btn').click();await page.locator('#search-input').fill(view!.subject.label);
 check(`${label} graph search results keyboard reachable`,await page.locator('#mobile-search-results button').first().isVisible());
 await page.locator('#mobile-search-results button').first().click();check(`${label} search locate returns to graph`,(await measure(page)).view==='graph'&&(await measure(page)).selection===view!.subject.id);
 const retained=await measure(page);await page.locator('#mobile-nav [data-mobile-view=evidence]').click();await page.keyboard.press('Escape');check(`${label} Escape preserves reading selection/camera`,(await measure(page)).view==='graph'&&same(retained.camera,(await measure(page)).camera)&&(await measure(page)).selection===retained.selection);
 // Search an actual aggregate member, not just the subject already painted at opening.
 const hiddenId=await page.evaluate(ids=>ids.find(id=>![...document.querySelectorAll<HTMLElement>('.node')].some(n=>n.dataset.nodeId===id)),view!.nodes.filter(n=>n.id!==view!.subject.id).map(n=>n.id));
 if(hiddenId) {
   const member=view!.nodes.find(n=>n.id===hiddenId)!;
   await page.locator('#search-btn').click();await page.locator('#search-input').fill(member.label);
   await page.locator('#mobile-search-results button').filter({hasText:member.label}).first().click();
   const target=await page.locator('[data-mobile-located]').boundingBox();const m=await measure(page);
   check(`${label} aggregate member search locates real declaring group`,m.selection===hiddenId&&!!target&&target.x>=0&&target.x+target.width<=width&&target.y>=m.stage.y&&target.y+target.height<=m.hud.y,{id:hiddenId,target,camera:m.camera});
 }
 // Finger count changes and cancellation must rebase, then permit a fresh normal tap.
 await page.locator('#zoom-fit').click();
 const rebased=await measure(page);const cy=rebased.stage.y+rebased.stage.height*.35,cx=width/2;
 await touch(cdp,'touchStart',[{x:cx-45,y:cy,id:1},{x:cx+45,y:cy,id:2}]);
 await touch(cdp,'touchMove',[{x:cx-60,y:cy,id:1},{x:cx+60,y:cy,id:2}]);
 // Chromium ends the supplied contact; omitting it in touchMove leaves it active.
 await touch(cdp,'touchEnd',[{x:cx+60,y:cy,id:2}]);await page.waitForTimeout(100);const oneBefore=await measure(page);
 await touch(cdp,'touchMove',[{x:cx-50,y:cy+10,id:1}]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);const oneAfter=await measure(page);
 check(`${label} pinch-to-one-finger rebases without jump or phantom selection`,Math.abs(oneAfter.focal[0]!-oneBefore.focal[0]!+10/oneBefore.ctm[0]!)<1&&Math.abs(oneAfter.focal[1]!-oneBefore.focal[1]!+10/oneBefore.ctm[0]!)<1&&oneAfter.selection===oneBefore.selection,{oneBefore,oneAfter});
 await touch(cdp,'touchStart',[{x:cx-30,y:cy,id:1},{x:cx+30,y:cy,id:2},{x:cx,y:cy+30,id:3}]);
 await touch(cdp,'touchCancel',[]);await page.waitForTimeout(100);await page.locator('#zoom-fit').click();
 const tapBox=(await page.locator('.node-box.is-subject').boundingBox())!;
 await touch(cdp,'touchStart',[{x:tapBox.x+tapBox.width/2,y:tapBox.y+tapBox.height/2}]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);
 check(`${label} cancel releases three pointers and a fresh tap reads selected node`,(await measure(page)).view==='evidence'&&(await measure(page)).selection===view!.subject.id,{actual:await measure(page),tapBox,hit:await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.outerHTML,{x:tapBox.x+tapBox.width/2,y:tapBox.y+tapBox.height/2})});
 await page.locator('#mobile-nav [data-mobile-view=graph]').click();
 const blank=await page.evaluate(()=>{const r=document.querySelector('#stage')!.getBoundingClientRect(),h=document.querySelector('#viewport-hud')!.getBoundingClientRect().top;for(let y=r.top+20;y<h-10;y+=20)for(let x=10;x<innerWidth;x+=20)if(document.elementFromPoint(x,y)?.id==='canvas')return{x,y};return null;});
 const beforeBlank=await measure(page);if(blank){await touch(cdp,'touchStart',[blank]);await touch(cdp,'touchEnd',[]);await page.waitForTimeout(100);}
 check(`${label} ordinary blank tap clears selection without camera movement`,!!blank&&!(await measure(page)).selection&&same(beforeBlank.camera,(await measure(page)).camera));
 await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
 check(`${label} empty Evidence has honest browse action`,await page.locator('#mobile-evidence-empty').isVisible()&&!await page.locator('#drawer').isVisible());
 await page.locator('#mobile-nav [data-mobile-view=graph]').click();
 await page.locator('#search-btn').click();await page.locator('#search-input').fill(view!.subject.label);
 await page.setViewportSize({width,height:Math.min(height,500)});await page.waitForTimeout(100);
 const searchBox=(await page.locator('#search-input').boundingBox())!, resultBox=(await page.locator('#mobile-search-results button').first().boundingBox())!;
 check(`${label} search usable with simulated keyboard viewport reduction`,searchBox.y>=0&&resultBox.y+resultBox.height<=Math.min(height,500)&&await page.locator('#search-input').evaluate(e=>e===document.activeElement),{searchBox,resultBox});
 await page.setViewportSize({width,height});await page.locator('#search-close').click();
 const apiBefore=requests.length;for(const tab of ['relations','evidence','graph'])await page.locator(`#mobile-nav [data-mobile-view=${tab}]`).click();
 check(`${label} view switches make no API requests and no runtime errors`,requests.length===apiBefore&&errors.length===0,{errors,apiRequestsBefore:apiBefore,apiRequestsAfter:requests.length});
 check(`${label} no overflow and reduced motion`,!(await measure(page)).overflow&&await page.locator('#mobile-nav button').first().evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(x=>parseFloat(x)===0)));
 evidence[`${width}x${height}-${repo}`]={revision:view!.revision,base,pan,pinch,anchor,fitted,selected,listScroll,reading,readScroll,located,errors};
 await cdp.detach();await page.close();
 }
 // Independent route history reproduction: Landing -> repository -> Back -> Forward.
 const historyPage=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const historyRequests:string[]=[];historyPage.on('request',r=>{if(r.url().includes('/api/'))historyRequests.push(r.url());});
 await historyPage.goto(app.url);await historyPage.locator('#repo-input').fill(A);await historyPage.locator('#submit').click();await historyPage.locator('.node-box.is-subject').waitFor();
 const historyCount=historyRequests.length;await historyPage.goBack();await historyPage.locator('#landing').waitFor();await historyPage.goForward();
 check('route Back/Forward restores Explorer shell without reanalysis',await historyPage.locator('#explorer').isVisible()&&!await historyPage.locator('#landing').isVisible()&&historyRequests.length===historyCount);
 await historyPage.locator('#mobile-nav [data-mobile-view=relations]').click();
 await historyPage.evaluate(()=>{const u=new URL(location.href);u.searchParams.set('depth','1');u.searchParams.set('mobile','relations');history.replaceState({},'',u);const next=new URL(u);next.searchParams.set('depth','2');next.searchParams.set('mobile','evidence');history.pushState({},'',next);dispatchEvent(new PopStateEvent('popstate'));});
 await historyPage.waitForResponse(r=>r.url().includes('/api/view/')&&r.url().includes('depth=2'));await historyPage.waitForTimeout(200);
 const backView = historyPage.waitForResponse(r=>r.url().includes('/api/view/')&&r.url().includes('depth=1'));
 await historyPage.goBack();await backView;await historyPage.locator('#mobile-relations').waitFor({state:'visible'});
 await historyPage.waitForFunction(()=>document.querySelector('#explorer-body')?.getAttribute('data-mobile-view')==='relations');
 check('depth-changing Back restores target mobile view',await historyPage.locator('#mobile-relations').isVisible()&&new URL(historyPage.url()).searchParams.get('depth')==='1');
 await historyPage.close();
 // Explicit presentation stress fixture; canonical acceptance above remains unmodified.
 const longText='packages/'+'WWWW非常长的目录/'.repeat(30)+'manifest.json';
 const stress=await browser.newPage({viewport:{width:1280,height:800},hasTouch:true});
 let stressEdge='';
 await stress.route('**/api/view/**',async route=>{const response=await route.fetch();const body=await response.json();stressEdge=body.data.edges[0].id;body.data.evidenceByRelationship[stressEdge][0].data.mobile_stress=longText;await route.fulfill({response,json:body});});
 await stress.goto(`${app.url}/${A}`);await stress.locator('.node-box.is-subject').waitFor();
 await stress.evaluate(id=>{history.pushState({},'',`?edge=${encodeURIComponent(id)}`);dispatchEvent(new PopStateEvent('popstate'));},stressEdge);
 await stress.locator('#drawer').waitFor();
 check('controlled long-data desktop fixture is truncated before phone transition',!(await stress.locator('#drawer-inner').innerText()).includes(longText));
 await stress.locator('.drawer-close').focus();await stress.setViewportSize({width:390,height:844});await stress.waitForFunction(()=>document.body.classList.contains('mobile-explorer'));
 check('phone breakpoint restores focus from hidden desktop close',await stress.evaluate(()=>{const e=document.activeElement!;const r=e.getBoundingClientRect();return e!==document.body&&r.width>0&&r.height>0;}));
 await stress.locator('#mobile-nav [data-mobile-view=evidence]').click();
 check('desktop-to-phone rerenders full long evidence without overflow', (await stress.locator('#drawer-inner').innerText()).includes(longText)&&!await stress.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
 await stress.setViewportSize({width:1280,height:800});await stress.waitForFunction(()=>!document.body.classList.contains('mobile-explorer'));
 check('desktop breakpoint restores focus from hidden mobile heading',await stress.evaluate(()=>{const e=document.activeElement!;const r=e.getBoundingClientRect();return e!==document.body&&r.width>0&&r.height>0;}));
 await stress.setViewportSize({width:390,height:844});await stress.waitForFunction(()=>document.body.classList.contains('mobile-explorer'));
 check('phone-desktop-phone cache retains full evidence', (await stress.locator('#drawer-inner').innerText()).includes(longText));
 await stress.screenshot({path:`${out}/390-long-evidence.png`});
 await stress.locator('#drawer-inner .d-src').first().focus();await stress.setViewportSize({width:1600,height:900});await stress.waitForFunction(()=>!document.body.classList.contains('mobile-explorer'));
 check('phone evidence link focus survives desktop card rebuild',await stress.locator('#rail-toggle').evaluate(e=>e===document.activeElement));
 await stress.locator('#drawer-inner .d-src').first().focus();await stress.setViewportSize({width:390,height:844});await stress.waitForFunction(()=>document.body.classList.contains('mobile-explorer'));
 check('desktop evidence link focus survives phone card rebuild',await stress.locator('#mobile-evidence-back').evaluate(e=>e===document.activeElement));
 await stress.close();
 let webkitStatus='unavailable';try{const w=await webkit.launch();await w.close();webkitStatus='installed, acceptance not executed';}catch(e){webkitStatus=String(e).split('\n')[0]!;}
 await writeFile(`${out}/results.json`,JSON.stringify({environment:'Chromium CDP touch simulation',webkit:webkitStatus,physicalDevice:'not verified',checks,evidence,events},null,2));
}finally{await browser.close();await app.cleanup();}
console.log(`Mobile: ${checks.filter(c=>c.ok).length}/${checks.length}`);if(checks.some(c=>!c.ok))process.exitCode=1;
