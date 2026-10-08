/** Real cached canonical graphs + controlled fixture scheduler, production client. */
import { chromium, type Page } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixtureServer, A, B } from './fixture-server.ts';
const out = resolve('artifacts/responsive', process.env.RESPONSIVE_PHASE ?? 'after');
await mkdir(out, {recursive:true});
const app = await fixtureServer();
const browser = await chromium.launch();
const checks: {name:string;ok:boolean;detail:unknown}[] = [];
const evidence: Record<string,unknown> = {};
function check(name:string,ok:boolean,detail:unknown='') {
  checks.push({name,ok,detail}); console.log(`${ok?'PASS':'FAIL'} ${name} ${JSON.stringify(detail)}`);
}
const same = (a:unknown,b:unknown) => JSON.stringify(a)===JSON.stringify(b);
async function measure(page:Page) { return page.evaluate(() => {
  const rect = (e:Element) => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}; };
  const svg=document.querySelector<SVGSVGElement>('#canvas')!, c=svg.getScreenCTM()!;
  const stage=rect(document.querySelector('#stage')!), hud=rect(document.querySelector('.viewport-hud')!);
  const visible=(id:string)=>getComputedStyle(document.querySelector(id)!).display!=='none';
  const rail=visible('#rail'), drawer=visible('#drawer');
  const panels=[...(rail?[rect(document.querySelector('#rail')!)]:[]),...(drawer?[rect(document.querySelector('#drawer')!)]:[])];
  const target=document.querySelector('.plate-row.is-selected, .node.is-selected .node-box');
  const t=target?rect(target):null;
  const intersection=(a:typeof stage,b:typeof stage)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
  const free={left:rail?panels[0]!.right:stage.x,right:drawer?rect(document.querySelector('#drawer')!).x:stage.right,top:stage.y,bottom:hud.y};
  const probes=t?[[t.x+2,t.y+2],[t.right-2,t.y+2],[t.x+2,t.bottom-2],[t.right-2,t.bottom-2],[t.x+t.w/2,t.y+t.h/2]]:[];
  return {stage,hud,rail,drawer,panels,target:t,free,
    intersections:t?panels.map(p=>intersection(t,p)):[],hudConflicts:panels.map(p=>intersection(hud,p)),
    contained:!!t&&t.x>=free.left-.5&&t.right<=free.right+.5&&t.y>=free.top-.5&&t.bottom<=free.bottom+.5,
    hittable:!!target&&probes.every(([x,y])=>(target.closest('.node')??target).contains(document.elementFromPoint(x!,y!))),
    ctm:{a:c.a,b:c.b,c:c.c,d:c.d,e:c.e,f:c.f},viewBox:svg.getAttribute('viewBox'),
    selection:location.search,subject:rect(document.querySelector('.node-box.is-subject')!),
    overflow:document.documentElement.scrollWidth>innerWidth};
}); }
try {
  for(const [width,height] of [[1920,1080],[1600,900],[1280,800],[1024,768],[768,1024],[820,1180],[844,390]]) {
    const page=await browser.newPage({viewport:{width:width!,height:height!},hasTouch:true});
    const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
    page.on('requestfailed',r=>errors.push(`${r.url()} ${r.failure()?.errorText}`));
    await page.goto(`${app.url}/${B}`);
    await page.locator('.plate-row[role=button]').first().waitFor({timeout:60000});
    await page.evaluate(()=>document.fonts.ready);
    if(await page.locator('#rail').isVisible()) await page.locator('#rail-toggle').click();
    const base=await measure(page);
    await page.locator('.plate-row[role=button]').first().click();
    const selected=await measure(page);
    check(`${width} evidence keeps selected row entirely visible`, selected.drawer&&selected.contained&&selected.hittable&&selected.intersections.every(a=>a===0),selected);
    check(`${width} panel preserves stage and screen scale`,same(base.stage,selected.stage)&&base.ctm.a===selected.ctm.a&&base.ctm.d===selected.ctm.d&&base.subject.w===selected.subject.w&&base.subject.h===selected.subject.h);
    await page.screenshot({path:`${out}/${width}-evidence.png`});
    await page.locator('#rail-toggle').click();
    const context=await measure(page);
    check(`${width} responsive panel policy`,context.rail&&(width!>=1600?context.drawer:!context.drawer)&&context.selection===selected.selection,context);
    check(`${width} context selected target visible and HUD uncovered`,context.contained&&context.hittable&&context.intersections.every(a=>a===0)&&context.hudConflicts.every(a=>a===0),context);
    await page.screenshot({path:`${out}/${width}-context.png`});
    await page.locator('#rail-toggle').click();
    const restored=await measure(page);
    check(`${width} context close restores evidence without losing selection`,!restored.rail&&restored.drawer&&restored.selection===selected.selection&&restored.contained);
    for(let i=0;i<3;i++){ await page.locator('#rail-toggle').click();await page.locator('#rail-toggle').click(); }
    const repeat=await measure(page);
    check(`${width} repeated transitions do not accumulate camera drift`,same(restored.ctm,repeat.ctm)&&same(restored.stage,repeat.stage)&&same(restored.hud,repeat.hud)&&restored.selection===repeat.selection,{restored,repeat});
    await page.locator('#rail-toggle').click();
    if(width!>=1600) await page.locator('#rail-close').click(); else await page.keyboard.press('Escape');
    check(`${width} Context close returns to evidence`,!(await measure(page)).rail&&(await measure(page)).drawer);
    await page.keyboard.press('Escape');
    check(`${width} evidence close restores graph focus`,!await page.locator('#drawer').isVisible()&&await page.locator('.plate-row[role=button]').first().evaluate(e=>e===document.activeElement));
    check(`${width} no horizontal overflow or runtime/request failures`,!(await measure(page)).overflow&&errors.length===0,errors);
    evidence[`${width}x${height}`]={base,selected,context,restored,repeat};
    await page.close();
  }
  // A second real graph has 97 relations: native touch scroll must stay in evidence.
  const touch=await browser.newPage({viewport:{width:1280,height:800},hasTouch:true});
  await touch.goto(`${app.url}/${A}`);
  await touch.locator('.node-box.is-subject').waitFor({timeout:60000});
  await touch.locator('.node').filter({has:touch.locator('.node-box.is-subject')}).locator('.node-hit').click();
  const nodeSelected=await measure(touch);
  await touch.locator('#rail-toggle').click();
  const nodeContext=await measure(touch);
  check('1280 selected node protected from context overlay',nodeContext.contained&&nodeContext.hittable&&nodeContext.ctm.a===nodeSelected.ctm.a&&same(nodeContext.stage,nodeSelected.stage),{nodeSelected,nodeContext});
  await touch.locator('#rail-close').click();
  const reading=await measure(touch);
  const scrollBefore=await touch.locator('#drawer-inner').evaluate(e=>({top:e.scrollTop,total:e.scrollHeight,height:e.clientHeight}));
  const box=await touch.locator('#drawer-inner').boundingBox();
  const cdp=await touch.context().newCDPSession(touch);
  const tx=box!.x+box!.width/2,ty=box!.y+box!.height-80;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
  for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-i*35}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  // Wait for native fling to settle before comparing exact retained reading position.
  await touch.waitForTimeout(1200);
  const scrollAfter=await touch.locator('#drawer-inner').evaluate(e=>e.scrollTop);
  const scrolled=await measure(touch);
  check('native touch evidence scroll never pans graph or clears selection',scrollBefore.total>scrollBefore.height&&scrollAfter>scrollBefore.top&&same(reading.ctm,scrolled.ctm)&&reading.selection===scrolled.selection&&scrolled.drawer,{scrollBefore,scrollAfter,reading,scrolled});
  await touch.locator('#rail-toggle').click();await touch.locator('#rail-close').click();
  const restoredScroll=await touch.locator('#drawer-inner').evaluate(e=>e.scrollTop);
  check('hidden evidence retains exact native scroll offset',restoredScroll===scrollAfter,{scrollAfter,restoredScroll});
  // Pick uncovered blank canvas for a real touch pan.
  const spot=await touch.evaluate(()=>{
    for(let y=150;y<innerHeight-120;y+=30) for(let x=300;x<700;x+=25) if(document.elementFromPoint(x,y)?.id==='canvas') return {x,y};
    return null;
  });
  const panBefore=await measure(touch);
  if(spot){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[spot]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:spot.x+45,y:spot.y-45}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await touch.waitForTimeout(100);
  const panAfter=await measure(touch);
  check('native touch canvas pan keeps evidence and selection',!!spot&&panBefore.viewBox!==panAfter.viewBox&&panBefore.selection===panAfter.selection&&panAfter.drawer&&same(panBefore.hud,panAfter.hud));
  await touch.setViewportSize({width:1600,height:900});
  await touch.waitForFunction(()=>document.querySelector('#explorer-body')?.getAttribute('data-panel-mode')==='wide');
  const wide=await measure(touch);
  await touch.locator('#rail-toggle').click();
  await touch.locator('#rail-close').focus();
  await touch.setViewportSize({width:1024,height:768});
  await touch.waitForFunction(()=>document.querySelector('#explorer-body')?.getAttribute('data-panel-mode')==='compact');
  const narrow=await measure(touch);
  check('live breakpoint reconciliation keeps zoom selection and one overlay',wide.ctm.a===narrow.ctm.a&&wide.selection===narrow.selection&&narrow.drawer&&!narrow.rail&&narrow.contained,{wide,narrow});
  check('breakpoint hiding focused Context returns focus to disclosure',await touch.locator('#rail-toggle').evaluate(e=>e===document.activeElement));
  await touch.locator('.drawer-close').click();
  check('node evidence close returns focus to selected graph node',await touch.locator('.node').filter({has:touch.locator('.node-box.is-subject')}).evaluate(e=>e===document.activeElement));
  await touch.setViewportSize({width:1280,height:800});
  await touch.waitForFunction(()=>document.querySelector('#canvas')?.getAttribute('viewBox')?.split(' ')[2]==='1280');
  check('graph redraw preserves returned node focus',await touch.locator('.node').filter({has:touch.locator('.node-box.is-subject')}).evaluate(e=>e===document.activeElement));
  await cdp.detach();await touch.close();
} finally {
  await writeFile(`${out}/results.json`,JSON.stringify({checks,evidence},null,2));
  await browser.close();await app.cleanup();
}
console.log(`${checks.filter(c=>c.ok).length}/${checks.length} responsive checks passed`);
if(checks.some(c=>!c.ok)) process.exitCode=1;
