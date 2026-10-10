import { runOffline, writeSidecar } from '../../src/discovery/offline.ts';
const result=await runOffline();await writeSidecar('artifacts/discovery-v2',result);
console.log(JSON.stringify({state:result.content.state,candidates:result.content.candidates.length,digest:result.receipt.contentDigest,usage:result.content.usage,wallMs:result.receipt.wallMs},null,2));
