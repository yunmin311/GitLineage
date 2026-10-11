/** Local-only interactive demo. Every GitHub response is a fixed offline fixture. */
import {fixtureServer,A} from './fixture-server.ts';
import {treeFixture} from '../discovery/tree-fixture.ts';
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
console.log(`OFFLINE FIXTURE ONLY — ${app.url}/${A}`);
console.log('Structure: Read fixed version, expand src/modules. History: Load earlier commits. Discovery: Search, choose unknown/example, Source Files, Compare. No live GitHub API requests.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.cleanup().then(()=>process.exit(0));});
