// Explicit three-repository interface probe. No Search observations are fabricated.
// Bootstrap names are caller-selected Phase0 public controls, not discovered results.
import {mkdir,writeFile} from 'node:fs/promises';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {NetworkLedger} from '../../src/discovery/network.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK,record} from '../../src/discovery/resolution.ts';
import {parseObservation} from '../../src/discovery/search-contract.ts';
import {collectSources} from '../../src/discovery/source-collection.ts';
import {pinnedCandidate} from '../../src/discovery/e2e.ts';
import {runComparison} from '../../src/discovery/worker.ts';
import {validateCandidate} from '../../src/discovery/contract.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
if(process.argv.slice(2).join(' ')!=='--live')throw new Error('requires explicit --live; default tests never connect');
const ledger=new BudgetLedger(SNAPSHOT_PROFILE),network=new NetworkLedger(ledger,SNAPSHOT_NETWORK),resolver=new RepositorySnapshotResolver(network),started=performance.now(),startedAt=new Date().toISOString();
const names=['sindresorhus/p-limit','jucke/p-limit','sindresorhus/p-throttle'],snapshots=[],bootstrap=[],comparisons=[];
for(const name of names){
 const metadata=await resolver.provider.get(`/repos/${name}`,network);const o=metadata?parseObservation(metadata,new Date().toISOString(),'repository_metadata'):null;bootstrap.push({name,observation:o,state:o?'identified':'inconclusive'});
 if(!o){snapshots.push({name,resolution:null,source:null,reason:`bootstrap: ${resolver.provider.failure()}`});continue;}
 const resolution=await resolver.resolve(o.repositoryId,[o]),source=await collectSources(resolution,[{path:'index.js',reason:'explicit Phase0 JS entry, latest resolved commit'}],resolver);snapshots.push({name,resolution,source,reason:null});
}
const first=snapshots[0];for(const item of snapshots.slice(1)){
 let candidate=null,summary=null,reason=null;
 try{if(!first?.resolution||!first.source||!item.resolution||!item.source)throw new Error('unresolved selected control');ledger.candidate(`github:${item.resolution.requestedId}`);
  candidate=pinnedCandidate([{source:'explicit_public_probe',version:'phase1c-public-controls@1',reason:'Phase0 selected control; not a Repository Search observation',locator:`https://github.com/${item.name}`}],first.resolution,item.resolution,first.source,item.source,ledger);
  if(!first.source.snapshot?.sources.length||!item.source.snapshot?.sources.length)throw new Error('no eligible selected source');
  const result=await runComparison(first.source.snapshot,item.source.snapshot,ledger);candidate.similarity=result.measurements;summary=result.summary;candidate.coverage.state=summary.state==='completed'?'completed':'partial';candidate.coverage.comparedPairs=summary.comparedPairs;candidate.coverage.reasons.push(...summary.failures);candidate.coverage.pending.push(...summary.failures);
 }catch(error){reason=error instanceof Error?error.message:'probe failure';if(candidate){candidate.coverage.state='partial';candidate.coverage.reasons.push(reason);candidate.coverage.pending.push(reason);}}
 if(candidate){candidate.usage=ledger.usage();validateCandidate(candidate);}comparisons.push({name:item.name,candidate,summary,reason,label:item.name==='jucke/p-limit'?'Phase0 known fork control; separately rechecked below':'unknown; unjudged'});
}
// Bounded common-commit availability recheck; no ancestry claim or Graph write.
let sharedCommit=null;const fork=snapshots[1];if(first?.resolution?.identity&&fork?.resolution?.identity){const commit=await resolver.provider.get(`/repositories/${first.resolution.requestedId}/commits/${fork.resolution.identity.revision}`,network);sharedCommit={upstreamId:first.resolution.requestedId,forkId:fork.resolution.requestedId,revision:fork.resolution.identity.revision,availableAtUpstream:commit!==null&&record(commit).sha===fork.resolution.identity.revision,forkMetadataParentMatches:fork.resolution.metadata.fork===true&&fork.resolution.metadata.parentId===first.resolution.requestedId};}
const full={schemaVersion:'discovery-public-snapshot-probe@1',scope:'three explicit Phase0 controls; no Search recall or Precision claim',bootstrap,snapshots:snapshots.map(s=>({...s,source:s.source?{...s.source,snapshot:s.source.snapshot?{...s.source.snapshot,sources:undefined}:null}:null})),comparisons,sharedCommit,budget:ledger.profile,usage:ledger.usage(),networkProfile:network.profile,network:network.usage(),sourceMaterializedBytes:snapshots.reduce((n,s)=>n+(s.source?.materializedBytes??0),0),verification:'pending',lineageClaim:'none',cpuBudget:'unsupported'};
// Observation clocks belong only to receipt. Source text is not persisted.
const observationTimes:unknown[]=[];function withoutTimes(v:unknown):unknown{if(Array.isArray(v))return v.map(withoutTimes);if(v&&typeof v==='object'){const obj=v as Record<string,unknown>;if('observedAt'in obj)observationTimes.push(obj);return Object.fromEntries(Object.entries(obj).filter(([k])=>k!=='observedAt').map(([k,x])=>[k,withoutTimes(x)]));}return v;}
const content=withoutTimes(full),receipt={schemaVersion:'discovery-public-probe-receipt@1',contentDigest:sha256(stableJSON(content)),startedAt,wallMs:performance.now()-started,observations:observationTimes,requests:resolver.provider.receipts,node:process.version,cpuBudget:'unsupported'};
await mkdir('artifacts/discovery-v2/phase1c-live',{recursive:true});await writeFile('artifacts/discovery-v2/phase1c-live/sidecar.json',stableJSON(content));await writeFile('artifacts/discovery-v2/phase1c-live/receipt.json',stableJSON(receipt));console.log(stableJSON({coverage:comparisons.map(c=>({name:c.name,state:c.candidate?.coverage.state??'inconclusive',reason:c.reason,summary:c.summary})),snapshots:snapshots.map(s=>({name:s.name,id:s.resolution?.requestedId,revision:s.resolution?.identity?.revision,state:s.resolution?.state,bindings:s.source?.bindings})),sharedCommit,usage:ledger.usage(),network:network.usage(),sourceMaterializedBytes:full.sourceMaterializedBytes,wallMs:receipt.wallMs}));
