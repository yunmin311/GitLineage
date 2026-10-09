import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {BudgetLedger} from './budget.ts';
import {NetworkLedger} from './network.ts';
import type {NetworkProfile} from './network.ts';
import type {BudgetProfile} from './budget.ts';
import {discoverRepositories} from './search.ts';
import type {ProviderOptions} from './search-provider.ts';
import type {QueryPlan} from './query.ts';
import {validatePlan} from './query.ts';
import {validateSearchCandidate} from './search-contract.ts';
import type {SearchCandidate} from './search-contract.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK,checkSnapshotProfile,validateResolution,validateTimelessResolution} from './resolution.ts';
import type {Resolution,TimelessResolution} from './resolution.ts';
import {collectSources,validateSelections} from './source-collection.ts';
import type {SourceSelection,CollectedSources} from './source-collection.ts';
import {validateCandidate,validateIdentity,validateUsage} from './contract.ts';
import type {DiscoveryCandidate} from './contract.ts';
import {sha256,gitBlob} from './snapshot.ts';
import type {SourceSnapshot} from './snapshot.ts';
import {runComparison} from './worker.ts';
import type {compareSnapshots} from './similarity.ts';
import {stableJSON} from './offline.ts';
const DEFAULT_SELECTION:SourceSelection[]=[{path:'index.js',reason:'explicit root JS entry; selected-path coverage only'}];
function timeless(r:Resolution):TimelessResolution{return{...r,observations:r.observations.map(({observedAt,...o})=>o)};}
function sourceView(s:CollectedSources){return{...s,snapshot:s.snapshot?{identity:s.snapshot.identity,files:s.snapshot.files,state:s.snapshot.state,pending:s.snapshot.pending,reasons:s.snapshot.reasons}:null};}
export interface EndToEndOptions extends ProviderOptions {now?:()=>string;profile?:BudgetProfile;network?:NetworkProfile;signal?:AbortSignal;selections?:Record<string,SourceSelection[]>;workerWallMs?:number}
/** Explicit v2→resolved→v1 adapter. Recheck every source binding and digest before
 * allocating a comparison worker. No unresolved identity crosses this boundary. */
export function comparableCandidate(search:SearchCandidate,target:Resolution,candidate:Resolution,first:CollectedSources,second:CollectedSources,ledger:BudgetLedger):DiscoveryCandidate {
 validateSearchCandidate(search);validateResolution(target);validateResolution(candidate);
 if(!target.identity||!candidate.identity||search.candidate.repositoryId!==candidate.requestedId||search.target.repositoryId!==target.requestedId||search.target.revision!==target.identity.revision)throw new TypeError('adapter requires matching pinned identities');
 return pinnedCandidate(search.discoveries.map(d=>({source:d.source,version:d.version,reason:d.reason,locator:d.query})),target,candidate,first,second,ledger);
}
/** Same binding checks for explicit public probes, with honest non-search provenance. */
export function pinnedCandidate(discoveries:DiscoveryCandidate['discoveries'],target:Resolution,candidate:Resolution,first:CollectedSources,second:CollectedSources,ledger:BudgetLedger):DiscoveryCandidate{
 validateResolution(target);validateResolution(candidate);if(!target.identity||!candidate.identity||!first.snapshot||!second.snapshot)throw new TypeError('adapter requires matching pinned identities');
 for(const [resolution,collected] of [[target,first],[candidate,second]] as const){const snapshot=collected.snapshot!;validateIdentity(snapshot.identity);if(stableJSON(snapshot.identity)!==stableJSON(resolution.identity))throw new TypeError('snapshot identity mismatch');
  if(collected.bindings.length!==snapshot.files.length)throw new TypeError('incomplete source bindings');for(const f of snapshot.files){const b=collected.bindings.find(b=>b.path===f.path);if(!b||b.repositoryId!==resolution.requestedId||b.revision!==resolution.identity!.revision||b.blob!==f.blob||b.digest!==f.digest||b.bytes!==f.bytes||b.parserVersion!==f.parserVersion||b.filterVersion!==f.filterVersion)throw new TypeError('file version or binding mismatch');}
  for(const s of snapshot.sources){const f=s.record;if(!snapshot.files.some(r=>stableJSON(r)===stableJSON(f))||Buffer.byteLength(s.content)!==f.bytes||sha256(s.content)!==f.digest||gitBlob(s.content)!==f.blob)throw new TypeError('source content digest mismatch');}
 }
 ledger.guard();
 const c:DiscoveryCandidate={schemaVersion:'discovery-candidate@1',target:structuredClone(target.identity),candidate:structuredClone(candidate.identity),discoveries:structuredClone(discoveries),similarity:[],files:{target:structuredClone(first.snapshot.files),candidate:structuredClone(second.snapshot.files)},checks:[],verification:{state:'pending',checks:[],canonicalEvidenceIds:[]},lineageClaim:'none',coverage:{state:'partial',expectedPairs:first.snapshot.sources.length*second.snapshot.sources.length,comparedPairs:0,pending:[...first.coverage.pending,...second.coverage.pending],reasons:[...first.coverage.reasons,...second.coverage.reasons]},usage:ledger.usage()};validateCandidate(c);return c;
}
/** Historical Phase1C replay only. Real public requests use runPinnedProbe with post-ID verification. */
export async function runSnapshotDiscovery(plan:QueryPlan,options:EndToEndOptions={}){
 if(!options.transport)throw new TypeError('historical E2E requires injected Mock transport; use runPinnedProbe');
 validatePlan(plan);if(plan.target.provider!=='github'||plan.target.repositoryId===null)throw new TypeError('E2E target requires stable GitHub ID and full commit');
 const profile=options.profile??SNAPSHOT_PROFILE;checkSnapshotProfile(profile);const ledger=new BudgetLedger(profile,options.signal),network=new NetworkLedger(ledger,options.network??SNAPSHOT_NETWORK);
 if(options.workerWallMs!==undefined&&(!Number.isSafeInteger(options.workerWallMs)||options.workerWallMs<1||options.workerWallMs>profile.wallMs))throw new TypeError('invalid reduced worker deadline');
 const selections=structuredClone(options.selections??{});for(const value of Object.values(selections))validateSelections(value);if(options.token&&JSON.stringify({plan,selections}).includes(options.token))throw new TypeError('credential reflected in inputs');
 const started=performance.now(),startedAt=options.now?.()??new Date().toISOString(),cpu=process.cpuUsage();const search=await discoverRepositories(plan,{transport:options.transport,token:options.token,timeoutMs:options.timeoutMs,now:options.now},network);
 const resolver=new RepositorySnapshotResolver(network,{...options,historicalRoutes:true});if(search.attempts.some(a=>['unauthorized','rate_limit','redirect_rejected'].includes(a.outcome)||a.headers['x-ratelimit-remaining']==='0'||a.headers['retry-after']&&(/^[0-9]+$/.test(a.headers['retry-after'])?Number(a.headers['retry-after'])>0:Number.isFinite(Date.parse(a.headers['retry-after'])))))resolver.provider.stopped=true;
 const target=await resolver.resolve(plan.target.repositoryId,[],plan.target.revision),targetSources=await collectSources(target,selections[String(plan.target.repositoryId)]??DEFAULT_SELECTION,resolver);
 const candidates:{repositoryId:number;resolution:TimelessResolution;source:ReturnType<typeof sourceView>;comparison:DiscoveryCandidate|null;summary:ReturnType<typeof compareSnapshots>['summary']|null;state:'completed'|'inconclusive';reasons:string[];verification:'pending';lineageClaim:'none'}[]=[];
 const resolutionReceipts:{repositoryId:number;observations:Resolution['observations']}[]=[{repositoryId:target.requestedId,observations:target.observations}];
 for(const discovered of search.candidates){
  const resolved=await resolver.resolve(discovered.candidate.repositoryId,discovered.candidate.observations);resolutionReceipts.push({repositoryId:resolved.requestedId,observations:resolved.observations});
  const sources=await collectSources(resolved,selections[String(resolved.requestedId)]??DEFAULT_SELECTION,resolver);
  let comparison:DiscoveryCandidate|null=null,summary:ReturnType<typeof compareSnapshots>['summary']|null=null;const reasons=[...resolved.reasons,...sources.coverage.reasons];
  try{
   if(discovered.candidate.conflicts.includes('name_id_collision'))throw new Error('name_id_collision: identity ambiguity retained');
   comparison=comparableCandidate(discovered,target,resolved,targetSources,sources,ledger);
   if(!targetSources.snapshot!.sources.length||!sources.snapshot!.sources.length){comparison.coverage.state='unavailable';comparison.coverage.reasons.push('no eligible source on one or both sides');}
   else{const result=await runComparison(targetSources.snapshot!,sources.snapshot!,ledger,options.workerWallMs);summary=result.summary;comparison.similarity=result.measurements;comparison.coverage.comparedPairs=summary.comparedPairs;comparison.coverage.state=summary.state==='completed'?'completed':summary.state==='partial'?'partial':'unavailable';comparison.coverage.reasons.push(...summary.failures);comparison.coverage.pending.push(...summary.failures);}
   comparison.checks=[{kind:'similarity',state:comparison.coverage.state,reasons:[...comparison.coverage.reasons]}];
  }catch(error){const reason=error instanceof Error?error.message:'comparison failed';reasons.push(reason);if(comparison){comparison.coverage.state='partial';comparison.coverage.pending.push(reason);comparison.coverage.reasons.push(reason);}}
  if(comparison){comparison.usage=ledger.usage();validateCandidate(comparison);reasons.push(...comparison.coverage.reasons);}
  candidates.push({repositoryId:resolved.requestedId,resolution:timeless(resolved),source:sourceView(sources),comparison,summary,state:comparison?.coverage.state==='completed'?'completed':'inconclusive',reasons:[...new Set(reasons)],verification:'pending',lineageClaim:'none'});
 }
 const content={schemaVersion:'discovery-e2e-sidecar@1' as const,candidateSchema:'discovery-candidate@1' as const,searchCandidateSchema:'discovery-candidate@2' as const,
  search:{plan:search.plan,candidates:search.candidates.map(c=>({...c,candidate:{...c.candidate,observations:c.candidate.observations.map(({observedAt,...o})=>o)},discoveries:c.discoveries.map(({observedAt,...d})=>d)})),coverage:search.coverage,queries:search.queries,rejectedIdentities:search.rejectedIdentities},
  target:{resolution:timeless(target),source:sourceView(targetSources)},candidates,
  requests:{search:search.attempts.map(({headers,...r})=>r),snapshot:resolver.provider.receipts.map(r=>r.request)},budget:ledger.profile,networkProfile:network.profile,usage:ledger.usage(),network:network.usage(),sourceMaterializedBytes:targetSources.materializedBytes+candidates.reduce((n,c)=>n+c.source.materializedBytes,0),
  coverage:{scope:'bounded search and explicit selected paths; no repository-wide scan',state:search.coverage.state==='complete_within_requested'&&candidates.length>0&&candidates.every(c=>c.state==='completed')?'completed':'partial',discovered:search.candidates.length,completed:candidates.filter(c=>c.state==='completed').length,inconclusive:candidates.filter(c=>c.state==='inconclusive').length},verification:'pending' as const,lineageClaim:'none' as const,cpuBudget:'unsupported' as const};
 const measured=process.cpuUsage(cpu);validateEndToEnd(content);
 return {content,receipt:{schemaVersion:'discovery-e2e-receipt@1',contentDigest:sha256(stableJSON(content)),startedAt,wallMs:performance.now()-started,processCpuMs:(measured.user+measured.system)/1000,cpuBudget:'unsupported',cpuScope:'process including workers; observational only',search:{wallMs:search.wallMs,requests:search.attempts,observations:search.candidates.map(c=>c.candidate.observations),discoveries:search.candidates.map(c=>c.discoveries)},resolution:resolutionReceipts,requests:resolver.provider.receipts,node:process.version,platform:process.platform}};
}
export type EndToEndContent=Awaited<ReturnType<typeof runSnapshotDiscovery>>['content'];
/** Export validator prevents graph relationships and checks file/version bindings.
 * Full v1 comparison validator remains authoritative for every comparable result. */
function closed(v:unknown,keys:string[]):void{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))throw new TypeError('invalid E2E shape');}
export function validateEndToEnd(content:EndToEndContent):void {
 closed(content,['schemaVersion','candidateSchema','searchCandidateSchema','search','target','candidates','requests','budget','networkProfile','usage','network','sourceMaterializedBytes','coverage','verification','lineageClaim','cpuBudget']);
 if(content.schemaVersion!=='discovery-e2e-sidecar@1'||content.candidateSchema!=='discovery-candidate@1'||content.searchCandidateSchema!=='discovery-candidate@2'||content.verification!=='pending'||content.lineageClaim!=='none'||content.cpuBudget!=='unsupported')throw new TypeError('invalid E2E boundary');
 validateUsage(content.usage,'usage');checkSnapshotProfile(content.budget);validatePlan(content.search.plan);
 const all=[content.target,...content.candidates];
 for(const item of all){const r=item.resolution;
  closed(item.source,['snapshot','selections','bindings','materializedBytes','coverage']);validateSelections(item.source.selections);closed(item.source.coverage,['scope','state','treeTruncated','reasons','pending']);
  if(!['completed','partial','unavailable'].includes(item.source.coverage.state)||item.source.coverage.scope!=='explicit selected paths only'||typeof item.source.coverage.treeTruncated!=='boolean'||!Number.isSafeInteger(item.source.materializedBytes)||item.source.materializedBytes<0)throw new TypeError('invalid source coverage');
  for(const b of item.source.bindings)closed(b,['repositoryId','revision','path','blob','digest','bytes','parserVersion','filterVersion']);
  validateTimelessResolution(r);
  const s=item.source.snapshot;if(s){closed(s,['identity','files','state','pending','reasons']);validateIdentity(s.identity);
   const draft:DiscoveryCandidate={schemaVersion:'discovery-candidate@1',target:s.identity,candidate:s.identity,discoveries:[{source:'snapshot_validation',version:'repository-snapshot@1',reason:'validate file records',locator:'explicit paths'}],similarity:[],files:{target:s.files,candidate:[]},checks:[],verification:{state:'pending',checks:[],canonicalEvidenceIds:[]},lineageClaim:'none',coverage:{state:'unexecuted',expectedPairs:0,comparedPairs:0,pending:[],reasons:[]},usage:content.usage};validateCandidate(draft);if(stableJSON(s.identity)!==stableJSON(r.identity)||s.files.length!==item.source.bindings.length)throw new TypeError('invalid snapshot binding');for(const f of s.files){const b=item.source.bindings.find(b=>b.path===f.path);if(!b||b.repositoryId!==r.requestedId||b.revision!==s.identity.revision||b.blob!==f.blob||b.digest!==f.digest||b.bytes!==f.bytes||b.parserVersion!==f.parserVersion||b.filterVersion!==f.filterVersion)throw new TypeError('invalid source binding');}}
 }
 for(const c of content.candidates){closed(c,['repositoryId','resolution','source','comparison','summary','state','reasons','verification','lineageClaim']);if(c.repositoryId!==c.resolution.requestedId||!['completed','inconclusive'].includes(c.state))throw new TypeError('invalid candidate identity');if(c.verification!=='pending'||c.lineageClaim!=='none')throw new TypeError('invalid candidate boundary');if(c.comparison){validateCandidate(c.comparison);if(stableJSON(c.comparison.candidate)!==stableJSON(c.resolution.identity)||stableJSON(c.comparison.target)!==stableJSON(content.target.resolution.identity)||stableJSON(c.comparison.files.candidate)!==stableJSON(c.source.snapshot?.files)||stableJSON(c.comparison.files.target)!==stableJSON(content.target.source.snapshot?.files))throw new TypeError('comparison snapshot binding mismatch');}if(c.state==='completed'&&c.comparison?.coverage.state!=='completed')throw new TypeError('invalid completion');}
 // This experimental schema has no canonical relationship/evidence collection.
 function noGraph(v:unknown):void{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(['relationships','derived_from','forked_from','similar_to','shares_history_with'].includes(k))throw new TypeError('canonical graph data prohibited');noGraph(x);}}noGraph(content);
 if(content.usage.activeWorkers!==0||content.usage.attempts>content.budget.attempts||content.network.reservedBytes>content.networkProfile.totalResponseBytes||content.network.retainedBytes>content.network.reservedBytes||content.sourceMaterializedBytes>content.usage.totalBytes)throw new TypeError('invalid resource receipt');
}
export async function writeEndToEnd(directory:string,result:Awaited<ReturnType<typeof runSnapshotDiscovery>>):Promise<void>{validateEndToEnd(result.content);if(result.receipt.contentDigest!==sha256(stableJSON(result.content)))throw new TypeError('content receipt digest mismatch');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'sidecar.json'),stableJSON(result.content));await writeFile(resolve(directory,'receipt.json'),stableJSON(result.receipt));}
