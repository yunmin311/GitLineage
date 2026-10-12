import {chromium} from 'playwright';
import {fixtureServer,A} from './fixture-server.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
import {mkdir,writeFile} from 'node:fs/promises';
const out=new URL('../../artifacts/visual-redesign',import.meta.url).pathname;await mkdir(out,{recursive:true});
const browser=await chromium.launch();const evidence=[];
try{for(const width of [390,430,1280,1920]){
const f=treeFixture();
f.repos[0]!.name=A.toLowerCase();
f.repos[0]!.files={
 'src/modules/main.ts':Buffer.from('export function map(values) { return values.map(value => value + 234); }\n'),
 'src/extra.ts':Buffer.from('export const extra = 123456;\n'),
 'package.json':Buffer.from(JSON.stringify({name:'workspace-fixture',dependencies:{'other-example':'^1.0.0'}})),
};
f.repos[3]!.files={'lib/core.ts':f.repos[0]!.files['src/modules/main.ts']!};f.rebuild();
for(const repo of f.repos){const base=f.routes.get(`/repos/${repo.name}/commits/${repo.revision}`) as {commit:Record<string,unknown>};
 const chain=[repo.revision,...Array.from({length:7},(_,i)=>(i+30).toString(16).padStart(40,'0'))];
 for(let i=0;i<chain.length;i++)f.routes.set(`/repos/${repo.name}/commits/${chain[i]}`,{...base,sha:chain[i],commit:{...base.commit,author:{name:'Offline fixture',date:'2026-10-11T00:00:00Z'},message:i===0?'Merge module changes':`Earlier module change ${i}`},parents:i===0?[{sha:chain[1]},{sha:chain[3]}]:i===2||i===4?[{sha:chain[5]}]:i<chain.length-1?[{sha:chain[i+1]}]:[],files:[{filename:'src/modules/main.ts',status:'modified',additions:3,deletions:1}]});
 f.routes.set(`/repos/${repo.name}/commits/main`,f.routes.get(`/repos/${repo.name}/commits/${repo.revision}`));
}

const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,explorationTransport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response(JSON.stringify([{name:'main',commit:{sha:f.repos[0]!.revision}}])):f.transport(url,init)});
const page=await browser.newPage({viewport:{width,height:width<768?932:1080},isMobile:width<768,hasTouch:width<768,reducedMotion:'reduce'});page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(app.url+'/'+A);await page.locator('.bundle-card').first().waitFor();
const group=page.locator('.bundle-card').filter({has:page.locator('.bundle-card-count',{hasText:'nebula_app'})});await group.focus();await page.keyboard.press('Enter');await page.locator('#zoom-fit').click();await page.screenshot({path:`${out}/${width}-graph.png`});
const surface=async(name:string)=>{if(width<768)await page.getByRole('navigation',{name:'Workspace views'}).getByRole('button',{name,exact:true}).click();};
await page.locator('#deep-launch').click();await surface('Navigate');await page.locator('#explore-load').click();await page.locator('.workspace-tree').waitFor();await page.locator('.workspace-tree [data-path="src"]').click();await page.locator('.workspace-tree [data-path="src/modules"]').click();await page.locator('[data-file="src/modules/main.ts"]').click();await surface('Canvas');await page.locator('#workspace-fit').click();await page.screenshot({path:`${out}/${width}-structure.png`});
await page.locator('#repository-history').click();await surface('Navigate');await page.locator('#explore-history-more').click();await page.waitForFunction(()=>document.querySelectorAll('#workspace-canvas .workspace-node').length===8);await page.locator('#explore-content [data-commit]').first().click();await surface('Canvas');await page.locator('#workspace-fit').click();await page.screenshot({path:`${out}/${width}-history.png`});
evidence.push(await page.evaluate(()=>({width:innerWidth,stage:document.querySelector('#workspace-canvas')!.getBoundingClientRect().toJSON(),ctm:document.querySelector<SVGSVGElement>('#workspace-canvas')!.getScreenCTM()!.toString(),box:document.querySelector('#workspace-canvas')!.getAttribute('viewBox'),nodes:[...document.querySelectorAll('.workspace-box')].map(n=>n.getBoundingClientRect().toJSON())})));
await page.locator('#repository-deep').click();await surface('Navigate');await page.locator('#deep-search-submit').click();await page.locator('#deep-candidates input').last().waitFor();await page.locator('#deep-candidates input').last().check();await page.locator('#deep-source-preview').click();await surface('Evidence');await page.locator('#deep-files input[value="src/modules/main.ts"]').waitFor();await page.locator('#deep-files input[value="src/modules/main.ts"]').check();await page.locator('#deep-files input[value="src/extra.ts"]').uncheck();await page.locator('#deep-compare').click();await page.locator('#deep-download').waitFor({state:'attached'});await surface('Canvas');await page.locator('#workspace-fit').click();await page.screenshot({path:`${out}/${width}-discovery.png`});await surface('Evidence');await page.screenshot({path:`${out}/${width}-inspector.png`});evidence.push({width,errors});await page.close();await app.cleanup();
}}finally{await browser.close();await writeFile(`${out}/geometry.json`,JSON.stringify(evidence,null,2));}
