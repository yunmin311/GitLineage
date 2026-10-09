/** Versioned preview envelope. Search observations never become verification evidence. */
import {validatePinnedProbe} from '../../src/discovery/pinned-probe.ts';
import type {runPinnedProbe} from '../../src/discovery/pinned-probe.ts';
import {validateSearchCandidate} from '../../src/discovery/search-contract.ts';
import type {SearchCandidate} from '../../src/discovery/search-contract.ts';
import type {DiscoveryCandidate} from '../../src/discovery/contract.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
export function searchDiscoveries(c:SearchCandidate):DiscoveryCandidate['discoveries'] {validateSearchCandidate(c);return c.discoveries.map(d=>({source:d.source,version:d.version,reason:d.reason,locator:`https://api.github.com/search/repositories?query=${encodeURIComponent(d.query)}&page=${d.page}&rank=${d.rank}`}));}
export interface PreviewExport {schemaVersion:'discovery-preview-export@1';provenance:{schemaVersion:'discovery-preview-provenance@1';searchTaskId:string;compareTaskId:string;searchContentDigest:string;target:{repositoryId:number;revision:string};candidates:{repositoryId:number;revision:string|null;searchCandidate:SearchCandidate}[];status:'search_observation_only'};probe:Awaited<ReturnType<typeof runPinnedProbe>>;contentDigest:string}
export function sealPreviewExport(provenance:PreviewExport['provenance'],probe:PreviewExport['probe']):PreviewExport {const payload={schemaVersion:'discovery-preview-export@1' as const,provenance:structuredClone(provenance),probe};const out={...payload,contentDigest:sha256(stableJSON(payload))};validatePreviewExport(out);return out;}
export function validatePreviewExport(value:unknown):asserts value is PreviewExport {
 const c=value as PreviewExport;if(!c||Object.keys(c).sort().join()!=='contentDigest,probe,provenance,schemaVersion'||c.schemaVersion!=='discovery-preview-export@1')throw new TypeError('invalid preview export');
 validatePinnedProbe(c.probe.content);if(c.probe.receipt.contentDigest!==sha256(stableJSON(c.probe.content)))throw new TypeError('probe digest mismatch');
 const p=c.provenance;if(!p||p.schemaVersion!=='discovery-preview-provenance@1'||p.status!=='search_observation_only'||! /^[a-f0-9]{24}$/.test(p.searchTaskId)||! /^[a-f0-9]{24}$/.test(p.compareTaskId)||p.searchTaskId===p.compareTaskId||! /^[a-f0-9]{64}$/.test(p.searchContentDigest)||!Array.isArray(p.candidates)||p.candidates.length!==c.probe.content.comparisons.length)throw new TypeError('invalid provenance');
 const target=c.probe.content.snapshots[0];if(!target||target.expectedId!==p.target.repositoryId||target.control.revision!==p.target.revision)throw new TypeError('target provenance mismatch');
 for(const [i,entry] of p.candidates.entries()){validateSearchCandidate(entry.searchCandidate);const snapshot=c.probe.content.snapshots[i+1]!,candidate=c.probe.content.comparisons[i]?.candidate;
  if(entry.repositoryId!==entry.searchCandidate.candidate.repositoryId||entry.repositoryId!==snapshot.expectedId||entry.revision!==(snapshot.resolution?.identity?.revision??null)||entry.searchCandidate.target.repositoryId!==p.target.repositoryId||entry.searchCandidate.target.revision!==p.target.revision)throw new TypeError('candidate provenance mismatch');
  if(candidate&&stableJSON(candidate.discoveries)!==stableJSON(searchDiscoveries(entry.searchCandidate)))throw new TypeError('discovery provenance mismatch');
 }
 const {contentDigest,...payload}=c;if(contentDigest!==sha256(stableJSON(payload)))throw new TypeError('preview digest mismatch');
}
