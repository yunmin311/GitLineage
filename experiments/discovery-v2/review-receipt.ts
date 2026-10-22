/** Versioned review receipt. V3 @1 remains verifiable; preview/candidate/Graph exports are unchanged. */
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
import {validatePreviewExport} from './preview-contract.ts';
import type {PreviewExport} from './preview-contract.ts';
import {moduleOf,recommendSources} from './representative-selection.ts';
import type {Recommendation} from './representative-selection.ts';
export type PairOutcome='exact_match'|'partial_similarity'|'no_obvious_similarity'|'unavailable';
export function createReviewReceipt(exported:PreviewExport,recommendation?:Recommendation){
 validatePreviewExport(exported);const content=exported.probe.content;
 if(exported.selection){const selection=exported.selection,index=selection.stages.findIndex(s=>s.taskId===selection.sourceTaskId),stages=selection.stages.slice(0,index+1);
  const derived=recommendSources(selection.repositories,{attempts:content.budget.attempts,usedAttempts:stages.reduce((n,s)=>n+s.attempts,0),reservedBytes:stages.reduce((n,s)=>n+s.reservedBytes,0),totalResponseBytes:content.networkProfile.totalResponseBytes,perResponseBytes:content.networkProfile.perResponseBytes,totalBytes:content.budget.totalBytes,usedBytes:0,filesPerRepository:content.budget.filesPerCandidate});
  if(recommendation&&stableJSON(recommendation)!==stableJSON(derived))throw new TypeError('recommendation does not match source listing budget');recommendation=derived;
 }

 const repositories=content.snapshots.map(s=>{
  const listing=exported.selection?.repositories.find(r=>r.repositoryId===s.expectedId),selected=s.control.selections.map(p=>p.path),read=s.source?.bindings.map(b=>b.path)??[],source=s.source?.snapshot?.files??[],eligible=listing?.files.filter(f=>f.selectable)??[],included=source.filter(f=>f.classification==='application_source'),readModules=[...new Set(included.map(f=>moduleOf(f.path)))].sort();
  const knownBytes=eligible.reduce((n,f)=>n+(f.bytes??0),0),sourceBytes=included.reduce((n,f)=>n+f.bytes,0);
  return {repositoryId:s.expectedId,fullName:s.control.name,revision:s.resolution?.identity?.revision??listing?.revision??null,selected,read,included:included.map(f=>f.path),filtered:source.filter(f=>f.classification!=='application_source').map(f=>({path:f.path,reason:f.classification})),pending:selected.filter(p=>!read.includes(p)),notSelected:eligible.filter(f=>!selected.includes(f.path)).map(f=>f.path).sort(),unsupported:listing?.files.filter(f=>f.language==='unsupported').map(f=>f.path)??[],readModules,uncoveredListedModules:[...new Set(eligible.map(f=>moduleOf(f.path)))].filter(m=>!readModules.includes(m)).sort(),unlistedDirectories:listing?.coverage.unlistedDirectories??[],byteCoverage:{readSourceBytes:sourceBytes,listedEligibleBytes:knownBytes,fraction:knownBytes?sourceBytes/knownBytes:null,scope:'listed eligible bytes only; unlisted and unsupported source excluded; not repository-wide coverage'},selectionReasons:selected.map(path=>({path,reason:recommendation?.repositories.find(r=>r.repositoryId===s.expectedId)?.selected.find(f=>f.path===path)?.reason??'manual selection; no automatic recommendation for this path'})),readFailures:s.source?.coverage.reasons??s.resolution?.reasons??[]};
 });
 const comparisons=content.comparisons.map((result,i)=>{
  const target=content.snapshots[0]!,candidate=content.snapshots[i+1]!,pairs=[];
  for(const first of target.control.selections)for(const second of candidate.control.selections){
   const measurements=result.candidate?.similarity.filter(m=>m.firstPath===first.path&&m.secondPath===second.path)??[],exact=measurements.find(m=>m.method==='exact_blob'),strict=measurements.find(m=>m.method==='strict_token5'),normalized=measurements.find(m=>m.method==='normalized_token5');
   let outcome:PairOutcome='unavailable';
   if(exact?.state==='completed'&&exact.score===1)outcome='exact_match';
   else if(strict?.state==='completed'&&normalized?.state==='completed')outcome=(strict.sharedShingles??0)>=5||(normalized.sharedShingles??0)>=5?'partial_similarity':'no_obvious_similarity';
   const priority=outcome==='exact_match'?'exact':outcome==='unavailable'?'unavailable':outcome==='no_obvious_similarity'?'no_signal':strict?.reasons.some(r=>r.startsWith('review-priority@1:review:'))?'review':'limited';
   pairs.push({priority,priorityReason:priority==='exact'?'Identical bytes; identity does not establish provenance':priority==='limited'?'Limited distinctive strict-token support; inspect raw measurements; renamed shared implementations can also fall here':strict?.reasons.find(r=>r.startsWith('review-priority@1:'))??'No review-priority annotation available',firstPath:first.path,secondPath:second.path,outcome,firstDigest:exact?.firstDigest??null,secondDigest:exact?.secondDigest??null,strict:strict?{state:strict.state,score:strict.score,shared:strict.sharedShingles,first:strict.firstShingles,second:strict.secondShingles}:null,normalized:normalized?{state:normalized.state,score:normalized.score,shared:normalized.sharedShingles,first:normalized.firstShingles,second:normalized.secondShingles}:null,reason:outcome==='unavailable'?'unread, filtered, parser/token limit or failed identity/worker; never a negative result':outcome==='exact_match'?'digest-checked identical Git blobs':'observation rule: at least five shared distinct 5-token shingles in strict or identifier-normalized mode; syntax/templates can satisfy this rule; not statistical significance'});
  }
  return {repositoryId:candidate.expectedId,expectedSelectedPairs:pairs.length,completedPairs:pairs.filter(p=>p.outcome!=='unavailable').length,pairs,aggregate:result.summary,scope:'Cartesian pairs of explicitly selected paths; unavailable pairs remain in denominator; aggregate distinct shingle sets deduplicate repeated tokens, not average file scores'};
 });
 const body={schemaVersion:'discovery-review-receipt@2' as const,previewContentDigest:exported.contentDigest,selectionVersion:recommendation?.schemaVersion??null,scope:'bounded selected source observations; code similarity does not prove copying, derivation or ancestry',outcomeRule:'exact blob equality; otherwise >=5 shared distinct strict or normalized 5-token shingles is a partial similarity observation; fewer means no obvious similarity under this rule; unavailable is never zero',repositories,comparisons,costs:exported.selection?.combined??{usage:content.usage,network:content.network},verification:'pending' as const,lineageClaim:'none' as const};
 return {...body,contentDigest:sha256(stableJSON(body))};
}
export type ReviewReceipt=ReturnType<typeof createReviewReceipt>;
export function validateReviewReceipt(receipt:unknown,exported:PreviewExport,recommendation?:Recommendation):void {
 let expected:unknown=createReviewReceipt(exported,recommendation);
 // V3 @1 has no priority annotations. Reconstruct its exact sealed shape.
 if(receipt&&typeof receipt==='object'&&'schemaVersion' in receipt&&receipt.schemaVersion==='discovery-review-receipt@1'){
  const {contentDigest,...body}=expected as ReviewReceipt;
  const legacy={...body,schemaVersion:'discovery-review-receipt@1',comparisons:body.comparisons.map(c=>({...c,pairs:c.pairs.map(({priority,priorityReason,...pair})=>pair)}))};
  expected={...legacy,contentDigest:sha256(stableJSON(legacy))};
 }
 if(stableJSON(expected)!==stableJSON(receipt))throw new TypeError('review receipt does not match pinned export or digest');
}
