/** Real Chromium paint/geometry checks for interruptible native motion. Offline only. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const out='artifacts/motion-refinement';await mkdir(out,{recursive:true});
const app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:unifiedFixture().transport});
const browser=await chromium.launch();const results=[];
try {for(const width of [390,430,1280,1920]) {
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width<768,isMobile:width<768});
 page.setDefaultTimeout(12000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url);await page.locator('.hero').waitFor();
 const entrance=await page.locator('.hero').evaluate(n=>{let count=0;for(let p:Element|null=n;p;p=p.parentElement)if(getComputedStyle(p).animationName.includes('reading-enter'))count++;return count;});
 assert.equal(entrance,1,'Landing has one entrance owner rather than nested opacity/translation');
 await page.waitForTimeout(300);await page.screenshot({path:`${out}/${width}-landing.png`});
 await page.goto(app.url+'/'+A);await page.locator('.bundle-card').first().waitFor();await page.waitForTimeout(300);
 // Exercise the actual motion module against the real rendered world. A controlled
 // paused frame makes interruption deterministic without timing-sensitive sleeps.
 const source=await readFile('src/web/client/lib/motion.mjs','utf8');
 await page.addScriptTag({content:source.replaceAll('export function ','function ')+'\nwindow.__testMotion={captureMotion,transitionScene,stopMotion};'});
 const probe=await page.evaluate(async()=>{
  const api=(window as unknown as {__testMotion:{captureMotion:(n:Element)=>Map<string,{rect:DOMRect}>,transitionScene:(n:Element,b:Map<string,{rect:DOMRect}>)=>void,stopMotion:(n:Element)=>void}}).__testMotion;
  const svg=document.querySelector<SVGSVGElement>('#canvas')!,node=svg.querySelector<SVGGElement>('[data-node-id]')!;
  const requestFrame=window.requestAnimationFrame;let unchangedFrames=0;window.requestAnimationFrame=cb=>{unchangedFrames++;return requestFrame(cb);};
  api.transitionScene(svg,api.captureMotion(svg));window.requestAnimationFrame=requestFrame;
  const camera=svg.getAttribute('viewBox'),stage=svg.getBoundingClientRect().toJSON(),ctm=svg.getScreenCTM()!;
  const initial=api.captureMotion(svg);initial.get(node.dataset.nodeId!)!.rect.x+=80;
  api.transitionScene(svg,initial);const a=node.getAnimations()[0]!;a.pause();a.currentTime=100;
  const painted=node.getBoundingClientRect().x,captured=api.captureMotion(svg);
  const capturedX=captured.get(node.dataset.nodeId!)!.rect.x;
  api.transitionScene(svg,captured);const next=node.getAnimations()[0]!;next.pause();next.currentTime=0;
  const resumed=node.getBoundingClientRect().x;api.stopMotion(svg);
  return{unchangedFrames,painted,capturedX,resumed,camera,stage,ctm:[ctm.a,ctm.d,ctm.e,ctm.f],cameraAfter:svg.getAttribute('viewBox')};
 });
 assert.ok(Math.abs(probe.capturedX-probe.painted)<.5,'Interruption captures the painted position before cancellation');
 assert.ok(Math.abs(probe.resumed-probe.painted)<.5,'Replacement starts at the last painted position');
 assert.equal(probe.unchangedFrames,0,'Unchanged graph schedules no per-frame interpolation');
 assert.equal(probe.cameraAfter,probe.camera,'Node motion cannot rewrite camera');
 // Actual graph expansion: retain keyboard focus and inspect painted frames.
 const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});
 if(await group.getAttribute('aria-expanded')==='true'){await group.focus();await page.keyboard.press('Enter');await page.waitForTimeout(300);}
 await group.focus();await page.keyboard.press('Enter');
 await page.locator('#canvas').evaluate(n=>{const animations=n.getAnimations({subtree:true});const entering=animations.find(a=>{const effect=a.effect as KeyframeEffect;return effect.getKeyframes().some(k=>Number(k.opacity)===0)&& (effect.target as Element)?.matches('.classification-node,.aggregate-member');});if(!entering)throw new Error('Expansion must animate a newly visible member');(window as unknown as {__entering:Element}).__entering=(entering.effect as KeyframeEffect).target as Element;for(const a of animations){a.pause();a.currentTime=0;}});
 const frames=[];
 for(const time of [0,130,260]) {
  await page.locator('#canvas').evaluate((n,t)=>{for(const a of n.getAnimations({subtree:true}))a.currentTime=t;},time);
  frames.push(await page.evaluate(()=>{const n=(window as unknown as {__entering:Element}).__entering;return{opacity:getComputedStyle(n).opacity,rect:n.getBoundingClientRect().toJSON()};}));
  await page.screenshot({path:`${out}/${width}-expand-${time}.png`});
 }
 assert.notEqual(frames[0]!.opacity,frames[1]!.opacity,'New neighborhood actually paints different animation frames');
 await page.locator('#canvas').evaluate(n=>{for(const a of n.getAnimations({subtree:true}))a.finish();});
 await page.evaluate(()=>{(window as unknown as {__motionLongTasks:number[]}).__motionLongTasks=[];new PerformanceObserver(list=>{for(const e of list.getEntries())(window as unknown as {__motionLongTasks:number[]}).__motionLongTasks.push(e.duration);}).observe({type:'longtask',buffered:false});});
 await group.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
 await page.waitForTimeout(320);assert.equal(await group.getAttribute('aria-expanded'),'true','Immediate collapse/reopen settles on latest intent');
 assert.equal(await group.evaluate(n=>document.activeElement===n),true,'Expansion retains keyboard owner');
 await page.emulateMedia({reducedMotion:'reduce'});await group.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#canvas').evaluate(n=>n.getAnimations({subtree:true}).length),0,'Reduced motion writes final graph without animation');
 await page.emulateMedia({reducedMotion:'no-preference'});const before=await page.locator('#canvas').getAttribute('viewBox');await page.locator('#workspace-history').click();await page.locator('.history-row').first().waitFor();await page.waitForTimeout(300);
 await page.locator('.history-row').nth(1).click();if(width<768)await page.locator('#history-list-return').click();await page.locator('.history-row').first().click();
 assert.equal(await page.locator('.history-detail').evaluate(n=>n.getAnimations({subtree:true}).length),0,'Commit reading does not replay entrances for every text block');
 await page.screenshot({path:`${out}/${width}-history.png`});await page.locator('#history-return').click();assert.equal(await page.locator('#canvas').getAttribute('viewBox'),before);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 const longTasks=await page.evaluate(()=>(window as unknown as {__motionLongTasks:number[]}).__motionLongTasks);results.push({width,probe,frames,longTasks});await page.close();
}await writeFile(`${out}/continuity.json`,JSON.stringify(results,null,2));console.log('PASS 390/430/1280/1920: painted interruption, expansion start/middle/end, rapid reversal, keyboard focus, reduced motion, History reading and exact camera return');
}finally{await browser.close();await app.cleanup();}
