import {createServer} from 'node:http';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fixtureServer,A} from './fixture-server.ts';
import {createBetaGate,passwordHash} from '../../experiments/private-beta/gate.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
import {validatePreviewExport} from '../../experiments/discovery-v2/preview-contract.ts';
import {cacheProof} from './cache-proof.ts';
const out=resolve('artifacts/private-beta');await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});const results=[];
try{for(const width of [390,430,1280,1920]){
 const root=await mkdtemp(join(tmpdir(),'gl-beta-browser-')),fixture=treeFixture();let gate:ReturnType<typeof createBetaGate>;
 const app=await fixtureServer({privateBetaHandler:async(req,res)=>gate.handler(req,res)});
 const salt='b'.repeat(32);gate=createBetaGate({enabled:true,origin:app.url,administrators:[{id:'admin',salt,passwordHash:passwordHash('browser-only-secret',salt)}],storeRoot:join(root,'beta'),protectedRoots:[app.fixtureCacheRoot,process.cwd()],transport:fixture.transport,cooldownMs:0});
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,acceptDownloads:true}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(app.url+'/'+A);await page.locator('#canvas .node-hit').first().waitFor();assert.equal(await page.locator('#deep-launch').count(),0);
 const cache=await cacheProof(app.fixtureCacheRoot);assert.equal((await page.request.post(app.url+'/api/deep-search/search',{data:{repository:'root/example'}})).status(),403);assert.equal(fixture.calls.length,0);
 const loginResponse=await page.goto(app.url+'/private-beta');assert.match(loginResponse!.headers()['content-security-policy']!,/frame-ancestors 'none'/);assert.equal(loginResponse!.headers()['x-frame-options'],'DENY');await page.locator('[name=identity]').fill('admin');await page.locator('[name=password]').fill('browser-only-secret');await page.locator('#login button').click();await page.waitForURL(app.url+'/');
 const workspaceResponse=await page.goto(app.url+'/'+A);assert.match(workspaceResponse!.headers()['content-security-policy']!,/frame-ancestors 'none'/);assert.equal(workspaceResponse!.headers()['x-frame-options'],'DENY');
 const attacker=createServer((_req,res)=>res.end(`<iframe src="${app.url}/${A}"></iframe><iframe src="${app.url}/private-beta"></iframe>`));await new Promise<void>(r=>attacker.listen(0,'127.0.0.1',r));const embedded=await context.newPage();try{await embedded.goto(`http://127.0.0.1:${(attacker.address() as {port:number}).port}`);await embedded.waitForTimeout(500);for(const frame of embedded.frames().slice(1))assert.equal(await frame.locator('#login, #canvas, #deep-launch').count(),0);}finally{await embedded.close();await new Promise<void>(r=>attacker.close(()=>r()));}
 await page.locator('#deep-launch').waitFor();const url=page.url(),viewBox=await page.locator('#canvas').getAttribute('viewBox');
 await page.locator('#deep-launch').click();await page.locator('#deep-repository').fill('root/example');await page.locator('#deep-search-submit').click();await page.locator('#deep-candidates input').first().waitFor();await page.locator('#deep-candidates input').last().check();await page.locator('#deep-source-preview').click();await page.locator('#deep-files input').first().waitFor();
 await page.locator('#deep-compare').click();await page.locator('#deep-results .deep-measurement').first().waitFor({timeout:10000});assert.match(await page.locator('#deep-results').innerText(),/pending/);
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#deep-download').click()]);const path=join(out,width+'-sidecar.json');await download.saveAs(path);const exported=JSON.parse(await readFile(path,'utf8'));validatePreviewExport(exported);assert.ok(!(await readFile(path,'utf8')).includes('browser-only-secret'));
 await page.screenshot({path:join(out,width+'-comparison.png'),fullPage:true});await page.locator('#deep-back').click();assert.equal(page.url(),url);assert.equal(await page.locator('#canvas').getAttribute('viewBox'),viewBox);assert.deepEqual(await cacheProof(app.fixtureCacheRoot),cache);await page.locator('#deep-launch').click();await page.locator('#deep-sign-out').click();await page.waitForURL(app.url+'/private-beta');assert.equal((await page.request.get(app.url+'/api/deep-search/capabilities')).status(),401);assert.deepEqual(errors,[]);results.push({width,status:'pass',requests:fixture.calls.length,verification:'pending',lineageClaim:'none'});
 }finally{await context.close();await gate.close();await app.cleanup();await rm(root,{recursive:true,force:true});}
}}finally{await browser.close();}await writeFile(join(out,'validation.json'),JSON.stringify({engine:'Chromium simulation',results},null,2));console.log('Private Beta browser acceptance passed',results);
