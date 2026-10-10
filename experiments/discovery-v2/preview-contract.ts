/** Versioned preview envelope. Search observations never become verification evidence. */
import {validatePinnedProbe} from '../../src/discovery/pinned-probe.ts';
import type {runPinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {validateSearchCandidate} from '../../src/discovery/search-contract.ts';
import type {SearchCandidate} from '../../src/discovery/search-contract.ts';
import type {DiscoveryCandidate} from '../../src/discovery/contract.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
export function searchDiscoveries(c:SearchCandidate):DiscoveryCandidate['discoveries'] {validateSearchCandidate(c);return c.discoveries.map(d=>({source:d.source,version:d.version,reason:d.reason,locator:`https://api.github.com/search/repositories?query=${encodeURIComponent(d.query)}&page=${d.page}&rank=${d.rank}`}));}
import type {SourceDirectory} from './source-selection.ts';
import type {discoverRepositories} from '../../src/discovery/search.ts';
import type {BudgetUsage} from '../../src/discovery/budget.ts';
import type {NetworkUsage} from '../../src/discovery/network.ts';
export interface SelectionReceipt {schemaVersion:'bounded-tree-selection@1';sourceTaskId:string;searchReceipt:Pick<Awaited<ReturnType<typeof discoverRepositories>>,'coverage'|'attempts'|'queries'|'usage'|'network'>;repositories:SourceDirectory[];selected:{repositoryId:number;paths:string[]}[];stages:{taskId:string;kind:string;wallMs:number;attempts:number;reservedBytes:number}[];combined:{usage:BudgetUsage;network:NetworkUsage;activeWallMs:number;elapsedWallMs:number};coverageScope:'selected files only; repository-wide coverage unknown'}
export interface PreviewExport {schemaVersion:'discovery-preview-export@1'|'discovery-preview-export@2';selection?:SelectionReceipt;provenance:{schemaVersion:'discovery-preview-provenance@1';searchTaskId:string;compareTaskId:string;searchContentDigest:string;target:{repositoryId:number;revision:string};candidates:{repositoryId:number;revision:string|null;searchCandidate:SearchCandidate}[];status:'search_observation_only'};probe:Awaited<ReturnType<typeof runPinnedProbe>>;contentDigest:string}
export function sealPreviewExport(provenance:PreviewExport['provenance'],probe:PreviewExport['probe'],selection?:SelectionReceipt):PreviewExport {const payload={schemaVersion:selection?'discovery-preview-export@2' as const:'discovery-preview-export@1' as const,...(selection?{selection:structuredClone(selection)}:{}),provenance:structuredClone(provenance),probe};const out={...payload,contentDigest:sha256(stableJSON(payload))};validatePreviewExport(out);return out;}
export function validatePreviewExport(value:unknown):asserts value is PreviewExport {
 const c=value as PreviewExport;if(!c||Object.keys(c).sort().join()!==(c.schemaVersion==='discovery-preview-export@2'?'contentDigest,probe,provenance,schemaVersion,selection':'contentDigest,probe,provenance,schemaVersion')||!['discovery-preview-export@1','discovery-preview-export@2'].includes(c.schemaVersion))throw new TypeError('invalid preview export');
 validatePinnedProbe(c.probe.content);if(c.probe.receipt.contentDigest!==sha256(stableJSON(c.probe.content)))throw new TypeError('probe digest mismatch');
 const p=c.provenance;if(!p||p.schemaVersion!=='discovery-preview-provenance@1'||p.status!=='search_observation_only'||! /^[a-f0-9]{24}$/.test(p.searchTaskId)||! /^[a-f0-9]{24}$/.test(p.compareTaskId)||p.searchTaskId===p.compareTaskId||! /^[a-f0-9]{64}$/.test(p.searchContentDigest)||!Array.isArray(p.candidates)||p.candidates.length!==c.probe.content.comparisons.length)throw new TypeError('invalid provenance');
 const target=c.probe.content.snapshots[0];if(!target||target.expectedId!==p.target.repositoryId||target.control.revision!==p.target.revision)throw new TypeError('target provenance mismatch');
 for(const [i,entry] of p.candidates.entries()){validateSearchCandidate(entry.searchCandidate);const snapshot=c.probe.content.snapshots[i+1]!,candidate=c.probe.content.comparisons[i]?.candidate;
  if(entry.repositoryId!==entry.searchCandidate.candidate.repositoryId||entry.repositoryId!==snapshot.expectedId||entry.revision!==(snapshot.resolution?.identity?.revision??null)||entry.searchCandidate.target.repositoryId!==p.target.repositoryId||entry.searchCandidate.target.revision!==p.target.revision)throw new TypeError('candidate provenance mismatch');
  if(candidate&&stableJSON(candidate.discoveries)!==stableJSON(searchDiscoveries(entry.searchCandidate)))throw new TypeError('discovery provenance mismatch');
 }
 if(c.schemaVersion==='discovery-preview-export@2'){const selection=c.selection;if(!selection||selection.schemaVersion!=='bounded-tree-selection@1'||! /^[a-f0-9]{24}$/.test(selection.sourceTaskId)||selection.coverageScope!=='selected files only; repository-wide coverage unknown')throw new TypeError('invalid selection receipt');
  if(!selection.searchReceipt||!Array.isArray(selection.searchReceipt.attempts)||selection.searchReceipt.usage.attempts!==selection.stages[0]?.attempts)throw new TypeError('invalid search resource receipt');
  if(selection.repositories.length!==c.probe.content.snapshots.length||selection.selected.length!==selection.repositories.length||selection.combined.usage.attempts>24||selection.combined.network.reservedBytes>1048576||!Number.isFinite(selection.combined.activeWallMs)||selection.combined.activeWallMs<0||selection.stages.reduce((n,s)=>n+s.attempts,0)!==selection.combined.usage.attempts||selection.stages.reduce((n,s)=>n+s.reservedBytes,0)!==selection.combined.network.reservedBytes)throw new TypeError('invalid combined resource receipt');
  if(stableJSON(selection.combined.usage)!==stableJSON(c.probe.content.usage)||stableJSON(selection.combined.network)!==stableJSON(c.probe.content.network))throw new TypeError('combined usage mismatch');
  for(const [i,r]of selection.repositories.entries()){const snapshot=c.probe.content.snapshots[i]!,selected=selection.selected[i]!;if(r.repositoryId!==snapshot.expectedId||r.revision!==snapshot.control.revision||selected.repositoryId!==r.repositoryId||stableJSON([...selected.paths].sort())!==stableJSON(snapshot.control.selections.map(s=>s.path).sort())||selected.paths.some(p=>!r.files.some(f=>f.path===p&&f.selectable)))throw new TypeError('source selection binding mismatch');}
 }
 const {contentDigest,...payload}=c;if(contentDigest!==sha256(stableJSON(payload)))throw new TypeError('preview digest mismatch');
}

/** A listing receipt is downloadable even when no file can be compared. */
export interface SourcePreviewExport {
 schemaVersion:'discovery-source-preview-export@1';searchTaskId:string;sourceTaskId:string;
 search:unknown;sources:{searchTaskId:string;targetId:number;candidateIds:number[];repositories:SourceDirectory[];usage:BudgetUsage;network:NetworkUsage};
 stages:{taskId:string;kind:string;wallMs:number;attempts:number;reservedBytes:number}[];
 verification:'pending';lineageClaim:'none';contentDigest:string;
}
export function sealSourceExport(payload:Omit<SourcePreviewExport,'contentDigest'>):SourcePreviewExport {
 const out={...structuredClone(payload),contentDigest:sha256(stableJSON(payload))};validateSourceExport(out);return out;
}
export function validateSourceExport(value:unknown):asserts value is SourcePreviewExport {
 const c=value as SourcePreviewExport;
 if(!c||c.schemaVersion!=='discovery-source-preview-export@1'||c.verification!=='pending'||c.lineageClaim!=='none'||! /^[a-f0-9]{24}$/.test(c.searchTaskId)||! /^[a-f0-9]{24}$/.test(c.sourceTaskId)||c.sources.searchTaskId!==c.searchTaskId)throw new TypeError('invalid source receipt');
 const ids=[c.sources.targetId,...c.sources.candidateIds];
 if(new Set(ids).size!==ids.length||ids.length!==c.sources.repositories.length||c.sources.usage.attempts>24||c.sources.network.reservedBytes>1048576||c.stages.reduce((n,s)=>n+s.attempts,0)!==c.sources.usage.attempts)throw new TypeError('invalid source receipt resources or identities');
 for(const [i,r]of c.sources.repositories.entries())if(r.repositoryId!==ids[i]||r.coverage.eligibleFiles!==r.files.filter(f=>f.selectable).length||!['complete','partial','failed','unavailable'].includes(r.coverage.enumeration))throw new TypeError('invalid listing coverage');
 const {contentDigest,...payload}=c;if(contentDigest!==sha256(stableJSON(payload)))throw new TypeError('source receipt digest mismatch');
}
