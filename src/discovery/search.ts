import { BudgetLedger, OFFLINE_PROFILE } from './budget.ts';
import type { BudgetProfile } from './budget.ts';
import { NetworkLedger, NETWORK_PROFILE } from './network.ts';
import type { NetworkProfile } from './network.ts';
import { RepositorySearchProvider } from './search-provider.ts';
import type { Transport, AttemptReceipt } from './search-provider.ts';
import { validatePlan } from './query.ts';
import type { QueryPlan } from './query.ts';
import { parseObservation, mergeIdentity, validateSearchCandidate } from './search-contract.ts';
import type { IdentityObservation, SearchCandidate, SearchDiscovery } from './search-contract.ts';
export { buildQueryPlan } from './query.ts';
export { comparisonIdentity } from './search-contract.ts';
export const SEARCH_PROFILE:Readonly<BudgetProfile>=Object.freeze({...OFFLINE_PROFILE,attempts:40,searchAttempts:4,candidates:16,wallMs:120000});
export interface SearchOptions {transport?:Transport;profile?:BudgetProfile;token?:string;signal?:AbortSignal;timeoutMs?:number;network?:NetworkProfile;now?:()=>string}
export type CoverageState='complete_within_requested'|'partial_budget'|'partial_provider'|'unavailable'|'cancelled'|'not_attempted';
export interface QueryReceipt {state:CoverageState;query:number;requestedPages:number[];completedPages:number[];totalCount:number|null;incompleteResults:boolean;returnedItems:number;unfetchedAccessiblePages:number|null;beyondWindow:number|null}
export async function discoverRepositories(inputPlan:QueryPlan,options:SearchOptions={}) {
 validatePlan(inputPlan);if(options.token&&JSON.stringify(inputPlan).includes(options.token))throw new TypeError('credential present in query inputs');const plan=structuredClone(inputPlan),profile=options.profile??SEARCH_PROFILE;
 // Experimental maxima cannot be silently lifted by a caller.
 for(const key of ['attempts','searchAttempts','candidates','wallMs','concurrency'] as const)if(profile[key]>SEARCH_PROFILE[key])throw new TypeError('profile exceeds experimental ceiling');
 const ledger=new BudgetLedger(profile,options.signal),network=new NetworkLedger(ledger,options.network??NETWORK_PROFILE),provider=new RepositorySearchProvider(options);
 const started=performance.now(),attempts:AttemptReceipt[]=[],queries:QueryReceipt[]=plan.queries.map((_,query)=>({state:'not_attempted',query,requestedPages:[],completedPages:[],totalCount:null,incompleteResults:false,returnedItems:0,unfetchedAccessiblePages:null,beyondWindow:null}));
 const records=new Map<number,{observations:IdentityObservation[];discoveries:SearchDiscovery[]}>(),buckets=plan.queries.map(()=>[] as number[]);
 const rejectedIdentities:{query:number;page:number;rank:number;reason:'invalid_or_missing_identity'|'credential_reflection'}[]=[];
 const candidates:SearchCandidate[]=[],admitted=new Map<number,SearchCandidate>();
 const quota=Math.max(1,Math.floor(profile.candidates/plan.queries.length)),admissions=plan.queries.map(()=>0);
 const admit=(id:number)=>{if(admitted.has(id))return true;try{ledger.candidate(`github:${id}`);}catch{budgetPartial=true;return false;}const record=records.get(id)!;const c:SearchCandidate={schemaVersion:'discovery-candidate@2',target:structuredClone(plan.target),candidate:mergeIdentity(record.observations),discoveries:record.discoveries,similarity:[],supportingFiles:[],verification:{state:'pending',canonicalEvidenceIds:[]},lineageClaim:'none',comparison:{state:'unexecuted',reason:'revision unresolved'}};admitted.set(id,c);candidates.push(c);return true;};
 let stopped=false,budgetPartial=false,providerPartial=false,cancelled=false,rejectedIdentity=0,returnedItems=0,excludedTarget=0;
 // Page rounds distribute request budget across sources before deeper pages.
 for(let page=1;page<=plan.pages&&!stopped;page++)for(let index=0;index<plan.queries.length&&!stopped;index++){
  const query=plan.queries[index]!,qr=queries[index]!;if(qr.totalCount!==null&&(page-1)*plan.perPage>=Math.min(qr.totalCount,1000))continue;
  qr.requestedPages.push(page);let result=await provider.page(query.q,plan.perPage,page,index,0,network);attempts.push(result.receipt);
  if(!result.stop&&(result.receipt.outcome==='network_error'||result.receipt.status!==null&&result.receipt.status>=500)&&(result.retryAfterMs===null||result.retryAfterMs===0)){
   result=await provider.page(query.q,plan.perPage,page,index,1,network);attempts.push(result.receipt);
  }
  if(result.stop)stopped=true;
  if(result.receipt.outcome==='cancelled'){cancelled=true;break;}
  if(result.receipt.outcome==='budget_denied'||result.receipt.outcome==='response_bytes_exhausted'){budgetPartial=true;continue;}
  if(!result.data){providerPartial=true;continue;}
  const data=result.data;qr.completedPages.push(page);if(qr.totalCount!==null&&qr.totalCount!==data.total_count)providerPartial=true;qr.totalCount=data.total_count;qr.incompleteResults ||= data.incomplete_results;qr.returnedItems+=data.items.length;returnedItems+=data.items.length;providerPartial ||= data.incomplete_results;
  const observedAt=options.now?.()??new Date().toISOString();if(!Number.isFinite(Date.parse(observedAt)))throw new TypeError('invalid receipt clock');
  for(let rank=0;rank<data.items.length;rank++){
   const observation=parseObservation(data.items[rank],observedAt);if(!observation||options.token&&observation.fullName.includes(options.token.toLowerCase())){rejectedIdentity++;rejectedIdentities.push({query:index,page,rank:rank+1,reason:observation?'credential_reflection':'invalid_or_missing_identity'});providerPartial=true;continue;}
   if(plan.target.repositoryId!==null&&observation.repositoryId===plan.target.repositoryId||plan.target.repositoryId===null&&observation.fullName===plan.target.fullName.toLowerCase()){excludedTarget++;continue;}
   let record=records.get(observation.repositoryId);if(!record){record={observations:[],discoveries:[]};records.set(observation.repositoryId,record);}
   record.observations.push(observation);record.discoveries.push({source:'repository_search',version:'github-rest-repository-search@1',query:query.q,querySource:query.source,reason:query.reason,page,rank:(page-1)*plan.perPage+rank+1,observedAt});
   if(!buckets[index]!.includes(observation.repositoryId))buckets[index]!.push(observation.repositoryId);
   if(!admitted.has(observation.repositoryId)&&admissions[index]!<quota&&admit(observation.repositoryId))admissions[index]=(admissions[index]??0)+1;
   const existing=admitted.get(observation.repositoryId);if(existing)existing.candidate=mergeIdentity(record.observations);
  }
 }
 let rejectedBudget=0;
 // Admit reserved per-query shares as pages arrive. Remaining capacity is filled
 // round-robin only while the ledger allows scheduling. Prior admissions survive
 // cancellation and keep all subsequent successful observation reasons.
 const selected=new Set<number>();
 for(let rank=0;rank<Math.max(0,...buckets.map(b=>b.length));rank++)for(const bucket of buckets){const id=bucket[rank];if(id===undefined||selected.has(id))continue;selected.add(id);if(!admit(id))rejectedBudget++;}
 // Name collisions inspect all valid observations, including non-admitted IDs.
 const names=new Map<string,Set<number>>();if(plan.target.repositoryId!==null)names.set(plan.target.fullName.toLowerCase(),new Set([plan.target.repositoryId]));for(const [id,r]of records)for(const o of r.observations){let ids=names.get(o.fullName);if(!ids){ids=new Set();names.set(o.fullName,ids);}ids.add(id);}
 for(const c of candidates)if(c.candidate.observations.some(o=>names.get(o.fullName)!.size>1)){c.candidate.conflicts.push('name_id_collision');c.candidate.completeness='incomplete';providerPartial=true;}
 for(const qr of queries)if(qr.totalCount!==null){qr.unfetchedAccessiblePages=Math.max(0,Math.ceil(Math.min(qr.totalCount,1000)/plan.perPage)-qr.completedPages.length);qr.beyondWindow=Math.max(0,qr.totalCount-1000);if(qr.unfetchedAccessiblePages||qr.beyondWindow)providerPartial=true;}
 cancelled ||= options.signal?.aborted??false;
 const completedPages=queries.reduce((n,q)=>n+q.completedPages.length,0);
 const state:CoverageState=cancelled?'cancelled':budgetPartial?'partial_budget':completedPages===0?(attempts.some(a=>a.reservedBytes>0)?'unavailable':'not_attempted'):providerPartial||stopped?'partial_provider':'complete_within_requested';
 for(const qr of queries){
  const qa=attempts.filter(a=>a.query===qr.query);
  qr.state=qa.some(a=>a.outcome==='cancelled')?'cancelled':qa.some(a=>['budget_denied','response_bytes_exhausted'].includes(a.outcome))?'partial_budget':!qa.some(a=>a.reservedBytes)?'not_attempted':!qr.completedPages.length?'unavailable':qr.incompleteResults||qr.unfetchedAccessiblePages||qr.beyondWindow||qa.some(a=>a.outcome!=='success')||rejectedIdentities.some(r=>r.query===qr.query)?'partial_provider':'complete_within_requested';
 }
 for(const c of candidates)validateSearchCandidate(c);
 return{schemaVersion:'discovery-search-sidecar@2' as const,candidateSchema:'discovery-candidate@2' as const,plan,candidates,queries,attempts,rejectedIdentities,
  coverage:{state,scope:'bounded public repository metadata search; never all GitHub',plannedQueries:plan.queries.length,attemptedQueries:new Set(attempts.filter(a=>a.reservedBytes).map(a=>a.query)).size,requestedPages:queries.reduce((n,q)=>n+q.requestedPages.length,0),completedPages,returnedItems,uniqueObserved:records.size,processedCandidates:candidates.length,rejectedIdentity,rejectedBudget,excludedTarget,accessibleWindow:1000,uncompletedPlanned:queries.map(q=>({query:q.query,pages:Array.from({length:plan.pages},(_,i)=>i+1).filter(p=>!q.completedPages.includes(p)&&(q.totalCount===null||(p-1)*plan.perPage<Math.min(q.totalCount,1000)))})).filter(q=>q.pages.length)},
  budget:ledger.profile,networkProfile:network.profile,usage:ledger.usage(),network:network.usage(),wallMs:performance.now()-started,cpuBudget:'unsupported',message:candidates.length?'发现候选尚未验证，不构成谱系关系。':'在本次查询范围与预算下，未发现候选。'};
}
