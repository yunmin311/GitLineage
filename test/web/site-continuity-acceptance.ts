import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const before=process.env.CAPTURE_BEFORE==='1',out=`artifacts/site-release/${before?'before':'after'}`;
await mkdir(out,{recursive:true});const browser=await chromium.launch(),results=[];
try{for(const width of [1920,1280,430,390]){
 const fixture=unifiedFixture(),app=await fixtureServer({phaseDelayMs:0,publicExploration:true,explorationCooldownMs:0,explorationTransport:fixture.transport});
 const p=await browser.newPage({viewport:{width,height:1000},isMobile:width<768,hasTouch:width<768});p.setDefaultTimeout(15000);const errors:string[]=[];p.on('pageerror',e=>errors.push(e.message));
 try{
 await p.goto(app.url);await p.locator('.lab-map').waitFor();assert.equal(await p.locator('.lab-picker').count(),0);assert.equal(await p.locator('.lab-open').getAttribute('href'),'#repo-input');await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-landing.png`,fullPage:true});
 const toggle=p.locator('.hero-trace-toggle').first();await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await p.goto(app.url+'/'+A);await p.locator('#canvas .node').first().waitFor();await p.waitForTimeout(1000);const camera=await p.locator('#canvas').getAttribute('viewBox');
 if(width<768)await p.locator('#mobile-nav [data-mobile-view=relations]').click();await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-navigation.png`});if(!before&&width<768)assert.equal(await p.locator('.mobile-family>summary').first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(220, 232, 241)','mobile relationship disclosures use shared grammar');
 await p.locator('#workspace-history').click();await p.locator('.history-row').first().waitFor();await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-history.png`});
 const toolbar=await p.locator('#git-history header').evaluate(n=>({height:n.getBoundingClientRect().height,bg:getComputedStyle(n).backgroundColor}));
 if(!before){assert(toolbar.height<=(width<768?120:68),`compact history toolbar ${width}: ${toolbar.height}`);assert.equal(toolbar.bg,'rgb(220, 232, 241)','History uses the shared blue identity surface');}
 await p.locator('.history-row').first().click();await p.locator('.history-detail-section').first().waitFor();await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-history-detail.png`});
 if(width<768)await p.locator('#history-list-return').click();const chooser=p.locator('.history-branch-picker');await chooser.locator('summary').click();await p.keyboard.press('Escape');assert.equal(await chooser.getAttribute('open'),null);
 await p.locator('#history-return').click();await p.waitForTimeout(400);assert.equal(await p.locator('#canvas').getAttribute('viewBox'),camera);
 if(width<768)await p.locator('#mobile-nav [data-mobile-view=relations]').click();await p.locator('#workspace-candidates').click();await p.locator('#deep-repository').fill(A);await p.locator('#deep-search-submit').click();await p.locator('#deep-candidates input').last().waitFor();await p.locator('#deep-candidates input').last().check();await p.locator('.deep-candidate').last().scrollIntoViewIfNeeded();await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-discovery.png`});
 const candidate=await p.locator('.deep-candidate.is-selected').first().evaluate(n=>({left:getComputedStyle(n).borderLeftWidth,right:getComputedStyle(n).borderRightWidth,pseudo:getComputedStyle(n,'::before').content}));if(!before){assert.equal(candidate.left,candidate.right,'No decorative vertical rule');assert(['none','normal'].includes(candidate.pseudo),'No selected-card pseudo stripe');}
 await p.locator('#deep-source-preview').click();await p.locator('#deep-files input[value="src/modules/main.ts"]').first().waitFor();await p.locator('#deep-files input[value="src/modules/main.ts"]').first().scrollIntoViewIfNeeded();await p.waitForTimeout(350);await p.screenshot({path:`${out}/${width}-files.png`});
 await p.emulateMedia({reducedMotion:'reduce'});const summary=p.locator('.deep-limits > summary');await summary.focus();await p.keyboard.press('Enter');await p.keyboard.press('Enter');assert(await summary.evaluate(n=>n===document.activeElement));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);results.push({width,toolbar,candidate,keyboard:true,returnCamera:true,reducedMotion:true,errors});console.log('PASS site continuity',width,before?'before':'after');
 }finally{await p.close();await app.cleanup();}
}}finally{await browser.close();await writeFile(out+'/checks.json',JSON.stringify({transport:'offline fixture',browser:'Chromium',physicalDevice:false,results},null,2));}
