/** Experimental public-control runner. No Search, cache, Graph writes or credential discovery. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {BudgetLedger} from './budget.ts';
import type {BudgetProfile} from './budget.ts';
import {NetworkLedger} from './network.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK,checkSnapshotProfile,fullSHA,validateTimelessResolution} from './resolution.ts';
import type {Resolution} from './resolution.ts';
import type {ProviderOptions} from './search-provider.ts';
import {parseObservation} from './search-contract.ts';
import type {IdentityObservation} from './search-contract.ts';
import {collectSources,validateSelections} from './source-collection.ts';
import type {SourceSelection} from './source-collection.ts';
import {pinnedCandidate} from './e2e.ts';
import {runComparison} from './worker.ts';
import {validateCandidate,validateUsage} from './contract.ts';
import type {DiscoveryCandidate} from './contract.ts';
import type {compareSnapshots} from './similarity.ts';
import {stableJSON} from './offline.ts';
import {sha256} from './snapshot.ts';
export interface ProbeControl {name:string;repositoryId:number|null;revision?:string;selections:SourceSelection[];observations?:IdentityObservation[]}
export interface ProbeOptions extends ProviderOptions {now?:()=>string;profile?:BudgetProfile;signal?:AbortSignal}
type Check={state:'matched'|'not_attempted'|'unavailable'|'id_conflict'|'name_changed';repositoryId:number|null;fullName:string|null;reason:string|null};
function view(source:Awaited<ReturnType<typeof collectSources>>){return {...source,snapshot:source.snapshot?{identity:source.snapshot.identity,files:source.snapshot.files,state:source.snapshot.state,pending:source.snapshot.pending,reasons:source.snapshot.reasons}:null};}
function timeless(r:Resolution){return {...r,observations:r.observations.map(({observedAt,...o})=>o)};}
export async function runPinnedProbe(controls:ProbeControl[],options:ProbeOptions={}){
 if(!Array.isArray(controls)||controls.length<2||controls.length>3)throw new TypeError('two or three explicit controls required');
 const names=new Set<string>(),ids=new Set<number>();for(const c of controls){if(!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(c.name)||['.','..'].includes(c.name.split('/')[1]!)||names.has(c.name)||c.repositoryId!==null&&(!Number.isSafeInteger(c.repositoryId)||c.repositoryId<1||ids.has(c.repositoryId))||c.revision!==undefined&&!fullSHA(c.revision))throw new TypeError('invalid explicit control');names.add(c.name);if(c.repositoryId!==null)ids.add(c.repositoryId);validateSelections(c.selections);}
 if(options.token&&JSON.stringify(controls).includes(options.token))throw new TypeError('credential reflection rejected');
 for(const c of controls)for(const o of c.observations??[])if(c.repositoryId===null||o.repositoryId!==c.repositoryId||!['repository_search','repository_metadata'].includes(o.source)||!parseObservation({id:o.repositoryId,full_name:o.fullName,html_url:o.htmlUrl},o.observedAt,o.source))throw new TypeError('invalid supplied observation');
 const profile=options.profile??SNAPSHOT_PROFILE;checkSnapshotProfile(profile);const ledger=new BudgetLedger(profile,options.signal),network=new NetworkLedger(ledger,SNAPSHOT_NETWORK),resolver=new RepositorySnapshotResolver(network,options),now=options.now??(()=>new Date().toISOString()),startedAt=now(),started=performance.now(),cpu=process.cpuUsage();
 const snapshots=[];
 for(const control of controls){
  // A null ID permits only an explicit name bootstrap, then a separate ID metadata check.
  const bootstrap=control.repositoryId===null?await resolver.provider.get(`/repos/${control.name}`,network):null;
  const observation=bootstrap?parseObservation(bootstrap,now(),'repository_metadata'):null;
  const expectedId=control.repositoryId??observation?.repositoryId??null;
  if(expectedId===null){snapshots.push({control:structuredClone(control),expectedId,bootstrap:null,resolution:null,source:null,identityCheck:{state:'not_attempted',repositoryId:null,fullName:null,reason:'bootstrap: '+resolver.provider.failure()} as Check,state:'inconclusive'});continue;}
  // Explicit caller names are aliases only, not fabricated Search observations.
  const resolution=await resolver.resolve(expectedId,[...(control.observations??[]),...(observation?[observation]:[])],control.revision);
  if(!observation&&resolution.identity&&resolution.identity.fullName!==control.name)resolution.reasons.push('caller_name_metadata_disagreement');
  const source=await collectSources(resolution,control.selections,resolver);
  const check:Check={state:'not_attempted',repositoryId:null,fullName:null,reason:'pre-resolution unavailable'};
  if(resolution.identity){const canonical=resolution.identity.fullName,raw=await resolver.provider.get(`/repos/${canonical}`,network),post=raw?parseObservation(raw,now(),'repository_metadata'):null;
   check.state=!post?'unavailable':post.repositoryId!==expectedId?'id_conflict':post.fullName!==canonical?'name_changed':'matched';check.repositoryId=post?.repositoryId??null;check.fullName=post?.fullName??null;check.reason=check.state==='matched'?null:post?`final identity: ${check.state}`:'final metadata: '+resolver.provider.failure();
   if(check.state!=='matched'){resolution.state='inconclusive';resolution.identity=null;resolution.tree=null;resolution.reasons.push(check.reason!);source.snapshot=null;source.bindings=[];source.coverage.state='unavailable';source.coverage.pending=control.selections.map(s=>s.path);source.coverage.reasons.push(check.reason!);}
  }
  snapshots.push({control:structuredClone(control),expectedId,bootstrap:observation,resolution,source,identityCheck:check,state:check.state==='matched'&&source.coverage.state==='completed'?'completed':'inconclusive'});
 }
 const comparisons:{name:string;candidate:DiscoveryCandidate|null;summary:ReturnType<typeof compareSnapshots>['summary']|null;reason:string|null;label:string}[]=[];
 for(const item of snapshots.slice(1)){let candidate:DiscoveryCandidate|null=null,summary:ReturnType<typeof compareSnapshots>['summary']|null=null,reason:string|null=null;const first=snapshots[0]!;
  try{if(first.identityCheck.state!=='matched'||item.identityCheck.state!=='matched'||!first.resolution||!item.resolution||!first.source?.snapshot?.sources.length||!item.source?.snapshot?.sources.length)throw new Error('no eligible identity-checked pinned source');ledger.candidate(`github:${item.expectedId}`);
   candidate=pinnedCandidate([{source:'explicit_public_probe',version:'phase1d-controls@1',reason:'explicit bounded controls; no Search or inferred lineage',locator:`https://github.com/${item.control.name}`}],first.resolution,item.resolution,first.source,item.source,ledger);
   const result=await runComparison(first.source.snapshot,item.source.snapshot,ledger);summary=result.summary;candidate.similarity=result.measurements;candidate.coverage.state=summary.state==='completed'?'completed':'partial';candidate.coverage.comparedPairs=summary.comparedPairs;candidate.coverage.reasons.push(...summary.failures);candidate.coverage.pending.push(...summary.failures);
  }catch(error){reason=error instanceof Error?error.message:'comparison failed';if(candidate){candidate.coverage.state='partial';candidate.coverage.reasons.push(reason);candidate.coverage.pending.push(reason);}}
  if(candidate){candidate.usage=ledger.usage();validateCandidate(candidate);}comparisons.push({name:item.control.name,candidate,summary,reason,label:item.control.name==='jucke/p-limit'?'known public Fork control; metadata observation only':'unknown; unjudged'});
 }
 const content={schemaVersion:'discovery-pinned-probe@1' as const,scope:'explicit controls and selected paths only; no discovery recall claim',snapshots:snapshots.map(s=>({...s,control:(({observations,...c})=>c)(s.control),bootstrap:s.bootstrap?(({observedAt,...o})=>o)(s.bootstrap):null,resolution:s.resolution?timeless(s.resolution):null,source:s.source?view(s.source):null})),comparisons,
  requests:resolver.provider.receipts.map(r=>r.request),budget:ledger.profile,networkProfile:network.profile,usage:ledger.usage(),network:network.usage(),sourceMaterializedBytes:snapshots.reduce((n,s)=>n+(s.source?.materializedBytes??0),0),coverage:{state:comparisons.every(c=>c.candidate?.coverage.state==='completed')?'completed':'partial',completed:comparisons.filter(c=>c.candidate?.coverage.state==='completed').length,inconclusive:comparisons.filter(c=>c.candidate?.coverage.state!=='completed').length},verification:'pending' as const,lineageClaim:'none' as const,cpuBudget:'unsupported' as const};
 validatePinnedProbe(content);const measured=process.cpuUsage(cpu);
 return {content,receipt:{schemaVersion:'discovery-pinned-probe-receipt@1',contentDigest:sha256(stableJSON(content)),startedAt,wallMs:performance.now()-started,processCpuMs:(measured.user+measured.system)/1000,cpuBudget:'unsupported',cpuScope:'process including workers; observational only',requests:resolver.provider.receipts,observations:snapshots.map(s=>({expectedId:s.expectedId,bootstrap:s.bootstrap,resolution:s.resolution?.observations??[]})),node:process.version,platform:process.platform}};
}
export type PinnedProbeContent=Awaited<ReturnType<typeof runPinnedProbe>>['content'];
export function validatePinnedProbe(c:PinnedProbeContent):void{
 const keys=['schemaVersion','scope','snapshots','comparisons','requests','budget','networkProfile','usage','network','sourceMaterializedBytes','coverage','verification','lineageClaim','cpuBudget'];
 if(Object.keys(c).sort().join()!==keys.sort().join()||c.schemaVersion!=='discovery-pinned-probe@1'||c.verification!=='pending'||c.lineageClaim!=='none'||c.cpuBudget!=='unsupported'||c.snapshots.length<2||c.snapshots.length>3)throw new TypeError('invalid probe boundary');
 checkSnapshotProfile(c.budget);validateUsage(c.usage,'usage');
 if(c.networkProfile.perResponseBytes!==SNAPSHOT_NETWORK.perResponseBytes||c.networkProfile.totalResponseBytes!==SNAPSHOT_NETWORK.totalResponseBytes||c.usage.attempts>c.budget.attempts||c.usage.activeWorkers!==0||c.network.reservedBytes>c.networkProfile.totalResponseBytes||c.network.retainedBytes>c.network.reservedBytes||c.sourceMaterializedBytes>c.usage.totalBytes)throw new TypeError('invalid probe usage');
 for(const s of c.snapshots){validateSelections(s.control.selections);if(s.resolution)validateTimelessResolution(s.resolution);const r=s.resolution,source=s.source;
  if(r&&(r.requestedId!==s.expectedId||r.identity&&s.control.revision!==undefined&&r.identity.revision!==s.control.revision)||s.control.repositoryId!==null&&s.expectedId!==s.control.repositoryId||s.bootstrap&&s.bootstrap.repositoryId!==s.expectedId)throw new TypeError('invalid expected identity');
  if(r&&r.requestSource!=='github-rest-verified-name@1')throw new TypeError('historical routes prohibited');
  if(s.identityCheck.state==='matched'&&(!r?.identity||s.expectedId!==r.requestedId||s.identityCheck.repositoryId!==s.expectedId||s.identityCheck.fullName!==r.identity.fullName))throw new TypeError('invalid final identity check');
  if(s.identityCheck.state!=='matched'&&(r?.identity||source?.snapshot||source?.bindings.length))throw new TypeError('unverified snapshot retained');
  if(s.state==='completed'&&(s.identityCheck.state!=='matched'||source?.coverage.state!=='completed'))throw new TypeError('invalid completed snapshot');
  if(source?.snapshot){const snap=source.snapshot;validateCandidate({schemaVersion:'discovery-candidate@1',target:snap.identity,candidate:snap.identity,discoveries:[{source:'snapshot_validation',version:'phase1d@1',reason:'validate selected files',locator:'explicit paths'}],similarity:[],files:{target:snap.files,candidate:[]},checks:[],verification:{state:'pending',checks:[],canonicalEvidenceIds:[]},lineageClaim:'none',coverage:{state:'unexecuted',expectedPairs:0,comparedPairs:0,pending:[],reasons:[]},usage:c.usage});if(stableJSON(snap.identity)!==stableJSON(r?.identity)||snap.files.length!==source.bindings.length)throw new TypeError('source identity mismatch');for(const f of snap.files){const b=source.bindings.find(b=>b.path===f.path);if(!b||b.repositoryId!==s.expectedId||b.revision!==snap.identity.revision||b.blob!==f.blob||b.digest!==f.digest||b.bytes!==f.bytes||b.parserVersion!==f.parserVersion||b.filterVersion!==f.filterVersion)throw new TypeError('source binding mismatch');}}
 }
 if(c.comparisons.length!==c.snapshots.length-1)throw new TypeError('missing comparison');
 for(let i=0;i<c.comparisons.length;i++){const result=c.comparisons[i]!,target=c.snapshots[0]!,other=c.snapshots[i+1]!;if(result.name!==other.control.name)throw new TypeError('comparison identity mismatch');if(result.candidate){validateCandidate(result.candidate);if(target.identityCheck.state!=='matched'||other.identityCheck.state!=='matched'||stableJSON(result.candidate.target)!==stableJSON(target.resolution?.identity)||stableJSON(result.candidate.candidate)!==stableJSON(other.resolution?.identity)||stableJSON(result.candidate.files.target)!==stableJSON(target.source?.snapshot?.files)||stableJSON(result.candidate.files.candidate)!==stableJSON(other.source?.snapshot?.files))throw new TypeError('invalid comparison binding');}}
 if(c.coverage.completed!==c.comparisons.filter(x=>x.candidate?.coverage.state==='completed').length||c.coverage.inconclusive!==c.comparisons.length-c.coverage.completed||c.coverage.state!==(c.coverage.inconclusive?'partial':'completed'))throw new TypeError('invalid coverage');
 function noGraph(x:unknown):void{if(!x||typeof x!=='object')return;for(const [k,v]of Object.entries(x)){if(['relationships','derived_from','forked_from','similar_to','shares_history_with'].includes(k))throw new TypeError('canonical Graph prohibited');noGraph(v);}}noGraph(c);
}
export async function writePinnedProbe(directory:string,result:Awaited<ReturnType<typeof runPinnedProbe>>):Promise<void>{validatePinnedProbe(result.content);if(result.receipt.contentDigest!==sha256(stableJSON(result.content)))throw new TypeError('probe receipt digest mismatch');await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'sidecar.json'),stableJSON(result.content));await writeFile(resolve(directory,'receipt.json'),stableJSON(result.receipt));}
