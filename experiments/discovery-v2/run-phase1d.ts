import {officialFixture,FIXED_TIME} from './phase1d-mock.ts';
import {runPinnedProbe,writePinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
if(process.argv.length!==2)throw new Error('offline entry takes no flags');
const f=officialFixture(),result=await runPinnedProbe(f.controls,{transport:f.transport,now:()=>FIXED_TIME});await writePinnedProbe('artifacts/discovery-v2/phase1d-mock',result);console.log(stableJSON({contentDigest:result.receipt.contentDigest,coverage:result.content.coverage,usage:result.content.usage}));
