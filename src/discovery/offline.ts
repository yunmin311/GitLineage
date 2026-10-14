import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BudgetLedger, OFFLINE_PROFILE } from './budget.ts';
import type { BudgetProfile } from './budget.ts';
import { validateCandidate } from './contract.ts';
import type { DiscoveryCandidate, SnapshotIdentity } from './contract.ts';
import { readSnapshot, readBoundedFile, sha256, FILTER_VERSION, PARSER_VERSION } from './snapshot.ts';
import type { SnapshotSpec, SourceSnapshot } from './snapshot.ts';
import { runComparison } from './worker.ts';
import type { compareSnapshots } from './similarity.ts';
export type Label='positive'|'negative'|'unknown';
export interface FixturePool {snapshots:SnapshotSpec[];cases:{target:string;candidate:string;label:Label;reason:string}[];metadataBytes:number;metadataDigest:string}
const fixtureRoot=fileURLToPath(new URL('../../experiments/discovery-v2/',import.meta.url));
/** Control-plane fixture descriptors are prepared before a run. Hard separate
 * 512 KiB metadata cap. Their bytes/digest are reported separately from source
 * read budget; all content bytes are charged when materialized as snapshots. */
export async function loadFixturePool():Promise<FixturePool> {
  const metadataLedger=new BudgetLedger({...OFFLINE_PROFILE,totalBytes:524288,filesPerCandidate:2});
  async function descriptor(path:string){return readBoundedFile(path,'metadata',path,metadataLedger);}
  const raw=await descriptor(resolve(fixtureRoot,'fixtures/manifest.json')),syntheticRaw=await descriptor(resolve(fixtureRoot,'phase1-fixtures.json'));
  const manifest=JSON.parse(raw.toString()),synthetic=JSON.parse(syntheticRaw.toString());
  const snapshots:SnapshotSpec[]=[...manifest.sources.map((s:any)=>({identity:{provider:'github',repositoryId:null,completeness:'name_only',fullName:s.repository,aliases:[],revision:s.revision},files:s.files.map((f:any)=>{
    if(!/^[\w.-]+$/.test(f.local))throw new Error('unsafe fixture local name');return{path:f.path,digest:f.sha256,local:resolve(fixtureRoot,'fixtures',f.local)};
  })})),...synthetic.sources.map((s:any)=>({identity:{provider:'synthetic',repositoryId:null,completeness:'synthetic',fullName:s.repository,aliases:[],revision:s.revision},files:s.files.map((f:any)=>({path:f.path,digest:f.sha256,content:f.content}))}))];
  return{snapshots,cases:synthetic.cases,metadataBytes:raw.length+syntheticRaw.length,metadataDigest:sha256(Buffer.concat([raw,syntheticRaw]))};
}
export function stableJSON(value:unknown):string {
  function ordered(v:unknown):unknown{if(Array.isArray(v))return v.map(ordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,ordered(x)]));return v;}
  return JSON.stringify(ordered(value),null,2)+'\n';
}
export function precision(labels:Label[],k:number,totalPositives:number) {
  const top=labels.slice(0,k),positives=top.filter(l=>l==='positive').length,unknown=top.filter(l=>l==='unknown').length,known=top.length-unknown;
  return{k,returned:top.length,unknown,recall:totalPositives?positives/totalPositives:null,precisionJudged:known?positives/known:null,precisionLower:positives/k,precisionUpper:(positives+unknown)/k};
}
export async function runOffline(options:{profile?:BudgetProfile;signal?:AbortSignal;pool?:FixturePool}={}) {
  // Input preparation is separate and explicit; cancellation governs the run.
  const pool=options.pool??await loadFixturePool(),ledger=new BudgetLedger(options.profile??OFFLINE_PROFILE,options.signal);
  const started=performance.now(),cpu=process.cpuUsage();
  const specs=new Map(pool.snapshots.map(s=>[s.identity.fullName,s])),loaded=new Map<string,SourceSnapshot>();
  const candidates:DiscoveryCandidate[]=[],summaries:{target:string;candidate:string;value:ReturnType<typeof compareSnapshots>['summary']|null}[]=[];
  const load=async(name:string)=>{let snapshot=loaded.get(name);if(!snapshot){const spec=specs.get(name);if(!spec)throw new Error('missing snapshot identity');snapshot=await readSnapshot(spec,ledger);loaded.set(name,snapshot);}return snapshot;};
  for(const item of pool.cases){const firstSpec=specs.get(item.target)!,secondSpec=specs.get(item.candidate)!;if(!firstSpec||!secondSpec)throw new Error('case references missing snapshot');
    const c:DiscoveryCandidate={schemaVersion:'discovery-candidate@1',target:structuredClone(firstSpec.identity),candidate:structuredClone(secondSpec.identity),
      discoveries:[{source:'fixed_pool',version:'synthetic-multifile@1',reason:item.reason,locator:'experiments/discovery-v2/phase1-fixtures.json'}],
      similarity:[],files:{target:[],candidate:[]},checks:[{kind:'similarity',state:'unexecuted',reasons:['not scheduled']}],verification:{state:'pending',checks:[],canonicalEvidenceIds:[]},lineageClaim:'none',
      coverage:{state:'unexecuted',expectedPairs:0,comparedPairs:0,pending:[item.candidate],reasons:['not scheduled']},usage:ledger.usage()};
    let value:ReturnType<typeof compareSnapshots>['summary']|null=null;
    try{
      ledger.candidate(`${item.target}|${item.candidate}`);
      const first=await load(item.target),second=await load(item.candidate);c.files={target:first.files,candidate:second.files};
      c.coverage={state:'partial',expectedPairs:first.sources.length*second.sources.length,comparedPairs:0,pending:[...first.pending,...second.pending],reasons:[...first.reasons,...second.reasons]};
      if(first.sources.length&&second.sources.length){const result=await runComparison(first,second,ledger);c.similarity=result.measurements;value=result.summary;
        c.coverage.comparedPairs=value.comparedPairs;c.coverage.state=value.state as 'completed'|'partial'|'unavailable';c.coverage.reasons.push(...value.failures);c.coverage.pending.push(...value.failures);
      }else{c.coverage.state=first.state==='partial'||second.state==='partial'?'partial':'unavailable';c.coverage.reasons.push('no eligible source on one or both sides');}
      c.checks=[{kind:'similarity',state:c.coverage.state,reasons:[...c.coverage.reasons]}];
    }catch(error){const reason=error instanceof Error?error.message:String(error);c.coverage.reasons.push(reason);c.checks=[{kind:'similarity',state:c.coverage.state,reasons:[...c.coverage.reasons]}];}
    c.usage=ledger.usage();validateCandidate(c);candidates.push(c);summaries.push({target:item.target,candidate:item.candidate,value});
  }
  const usage=ledger.usage();
  const content={schemaVersion:'discovery-sidecar@1',candidateSchema:'discovery-candidate@1',versions:{filter:FILTER_VERSION,parser:PARSER_VERSION,methods:['git-blob-sha1@1','token5-set@1']},
    inputSnapshots:pool.snapshots.map(s=>s.identity),metadata:{bytes:pool.metadataBytes,digest:pool.metadataDigest,capBytes:524288},
    candidates,summaries,labels:pool.cases,state:candidates.every(c=>c.coverage.state==='completed'||c.coverage.state==='unavailable')?'completed':'partial',
    coverage:{scope:'fixed pool only; no external discovery',planned:pool.cases.length,completed:candidates.filter(c=>c.coverage.state==='completed').length,unavailable:candidates.filter(c=>c.coverage.state==='unavailable').length,pending:candidates.filter(c=>c.coverage.state==='partial'||c.coverage.state==='unexecuted').map(c=>`${c.target.fullName}|${c.candidate.fullName}`)},
    budget:ledger.profile,usage,diagnostics:['name_only public identities: numeric GitHub IDs unavailable in pinned manifest','no verification adapter; zero graph writes','coverage ratios use distinct shingles, not token span coverage','identifier normalization also collapses properties/imports; auxiliary only']};
  const measuredCpu=process.cpuUsage(cpu);
  return{content,receipt:{schemaVersion:'discovery-receipt@1',contentDigest:sha256(stableJSON(content)),node:process.version,platform:process.platform,wallMs:performance.now()-started,processCpuMs:(measuredCpu.user+measuredCpu.system)/1000,cpuBudget:'unsupported',cpuScope:'process including workers; observational only',metadataPreparationOutsideRun:true}};
}
export async function writeSidecar(directory:string,result:Awaited<ReturnType<typeof runOffline>>) {
  for(const c of result.content.candidates)validateCandidate(c);
  await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'sidecar.json'),stableJSON(result.content));await writeFile(resolve(directory,'receipt.json'),stableJSON(result.receipt));
}
