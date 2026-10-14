/** Reuse the pinned, licensed Phase 1A control pool; no network or new threshold. */
import {runOffline} from '../../src/discovery/offline.ts';
import {mkdir,writeFile} from 'node:fs/promises';
const result=await runOffline();
const report={schemaVersion:'m2-controls@1',scope:'fixed pool; not real candidate discovery recall',parentContentDigest:result.receipt.contentDigest,cpuBudget:'unsupported',wallMs:result.receipt.wallMs,usage:result.content.usage,cases:result.content.labels.map((label,i)=>({label,candidate:result.content.candidates[i],summary:result.content.summaries[i]?.value})),verification:'pending',lineageClaim:'none'};
await mkdir('artifacts/deep-search/controls',{recursive:true});await writeFile('artifacts/deep-search/controls/results.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({digest:report.parentContentDigest,cases:report.cases.length,wallMs:report.wallMs,attempts:report.usage.attempts}));
