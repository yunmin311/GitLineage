// One explicit anonymous run; never reads credentials or changes identity after 403.
import {readFile} from 'node:fs/promises';
import {runPinnedProbe,writePinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
if(process.argv.slice(2).join(' ')!=='--live')throw new Error('requires explicit --live; default tests never connect');
// Honor the latest saved refusal/reset before any network request.
const previous=['experiments/discovery-v2/phase1c-live-receipt.json','artifacts/discovery-v2/phase1d-live/receipt.json'];
for(const path of previous){let raw:string;try{raw=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}const receipt=JSON.parse(raw);for(const r of receipt.requests??[]){const h=r.headers??{},reset=Number(h['x-ratelimit-reset']);if(h['x-ratelimit-remaining']==='0'&&Number.isFinite(reset)&&Date.now()<reset*1000)throw new Error(`saved anonymous limit window active until ${new Date(reset*1000).toISOString()}; no HTTP sent`);}}
const manifest=JSON.parse(await readFile('experiments/discovery-v2/fixtures/manifest.json','utf8'));
const names=['sindresorhus/p-limit','jucke/p-limit','sindresorhus/p-throttle'];
const controls=names.map(name=>{const source=manifest.sources.find((s:{repository:string})=>s.repository===name),file=source?.files.find((f:{path:string})=>f.path==='index.js');if(!source||!file)throw new Error('missing pinned public control');return {name,repositoryId:null,revision:source.revision,selections:[{path:'index.js',reason:'explicit MIT Phase0 pinned public entry; SHA256 independently recorded',expectedDigest:file.sha256}]};});
const result=await runPinnedProbe(controls);await writePinnedProbe('artifacts/discovery-v2/phase1d-live',result);
console.log(stableJSON({contentDigest:result.receipt.contentDigest,coverage:result.content.coverage,snapshots:result.content.snapshots.map(s=>({name:s.control.name,id:s.expectedId,revision:s.resolution?.identity?.revision,tree:s.resolution?.tree,state:s.state,check:s.identityCheck,bindings:s.source?.bindings,reasons:s.resolution?.reasons})),measurements:result.content.comparisons.map(c=>({name:c.name,summary:c.summary,reason:c.reason})),usage:result.content.usage,network:result.content.network,wallMs:result.receipt.wallMs}));
