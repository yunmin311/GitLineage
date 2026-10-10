// Offline failure receipts only. These IDs, statuses and byte counts are simulated.
import {mkdir,writeFile} from 'node:fs/promises';
import {officialFixture,FIXED_TIME} from './phase1d-mock.ts';
import {runPinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
if(process.argv.length!==2)throw new Error('offline command takes no flags');
const cases=[];
for(const mode of ['id_conflict','post_id_conflict','redirect_301','limit_403','missing_404','file_unavailable']){
 const f=officialFixture();
 if(mode==='id_conflict')f.routes.set('/repositories/2',{...(f.routes.get('/repositories/2') as object),id:99});
 if(mode==='post_id_conflict')f.routes.set('/repos/fork/example',{...(f.routes.get('/repos/fork/example') as object),id:99});
 if(mode==='file_unavailable')f.controls[1]!.selections[0]!.path='absent.js';
 const status=mode==='redirect_301'?301:mode==='limit_403'?403:mode==='missing_404'?404:null;
 const transport:typeof f.transport=async(url,init)=>status&&url.endsWith('/repositories/2')?new Response('',{status,headers:{location:'https://evil.invalid','x-ratelimit-remaining':status===403?'0':'10','x-ratelimit-reset':'1791545941'}}):f.transport(url,init);
 const result=await runPinnedProbe(f.controls,{transport,now:()=>FIXED_TIME});cases.push({mode,evidenceKind:'synthetic Mock; not actual GitHub response',...result});
}
await mkdir('artifacts/discovery-v2/phase1d-failures',{recursive:true});await writeFile('artifacts/discovery-v2/phase1d-failures/receipts.json',stableJSON({schemaVersion:'discovery-pinned-failure-fixtures@1',cases}));console.log(stableJSON(cases.map(c=>({mode:c.mode,coverage:c.content.coverage}))));
