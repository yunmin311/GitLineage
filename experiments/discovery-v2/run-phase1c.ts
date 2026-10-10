import {mockFixture,FIXED_TIME} from './phase1c-mock.ts';
import {runSnapshotDiscovery,writeEndToEnd} from '../../src/discovery/e2e.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
const f=mockFixture();if(process.argv.length!==2)throw new Error('offline command takes no flags; use run-phase1c-live.ts --live explicitly');
const r=await runSnapshotDiscovery(f.plan,{transport:f.transport,now:()=>FIXED_TIME});await writeEndToEnd('artifacts/discovery-v2/phase1c-mock',r);
console.log(stableJSON({contentDigest:r.receipt.contentDigest,coverage:r.content.coverage,usage:r.content.usage,network:r.content.network,sourceMaterializedBytes:r.content.sourceMaterializedBytes,labels:f.repos.slice(1).map(repo=>({repositoryId:repo.id,label:repo.label,scope:'constructed fixture only'})),measurements:r.content.candidates.map(c=>({id:c.repositoryId,state:c.state,summary:c.summary})),wallMs:r.receipt.wallMs}));
