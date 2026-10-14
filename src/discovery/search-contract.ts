import { validateIdentity } from './contract.ts';
import type { SnapshotIdentity } from './contract.ts';
export interface IdentityObservation {repositoryId:number;fullName:string;htmlUrl:string;source:'repository_search'|'repository_metadata';observedAt:string}
export interface SearchIdentity {provider:'github';repositoryId:number;completeness:'provider_id'|'incomplete';fullName:string;aliases:string[];htmlUrl:string;observations:IdentityObservation[];conflicts:string[];revision:{state:'unresolved';sha:null}}
export interface SearchDiscovery {source:'repository_search';version:'github-rest-repository-search@1';query:string;querySource:string;reason:string;page:number;rank:number;observedAt:string}
export interface SearchCandidate {schemaVersion:'discovery-candidate@2';target:SnapshotIdentity;candidate:SearchIdentity;discoveries:SearchDiscovery[];similarity:[];supportingFiles:[];verification:{state:'pending';canonicalEvidenceIds:[]};lineageClaim:'none';comparison:{state:'unexecuted';reason:'revision unresolved'}}
const name=/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/;
export function parseObservation(value:unknown,observedAt:string,source:IdentityObservation['source']='repository_search'):IdentityObservation|null {
 if(!['repository_search','repository_metadata'].includes(source))throw new TypeError('invalid identity source');
 if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>;
 if(!Number.isSafeInteger(v.id)||Number(v.id)<=0||typeof v.full_name!=='string'||!name.test(v.full_name)||['.','..'].includes(v.full_name.split('/')[1]!)||typeof v.html_url!=='string')return null;
 if(v.html_url.toLowerCase()!==`https://github.com/${v.full_name}`.toLowerCase())return null;
 if(!Number.isFinite(Date.parse(observedAt)))throw new TypeError('invalid observation time');
 return{repositoryId:Number(v.id),fullName:v.full_name.toLowerCase(),htmlUrl:`https://github.com/${v.full_name.toLowerCase()}`,source,observedAt};
}
export function mergeIdentity(observations:IdentityObservation[]):SearchIdentity {
 if(!observations.length||new Set(observations.map(o=>o.repositoryId)).size!==1)throw new TypeError('merge requires one proven provider ID');
 for(const o of observations)if(!parseObservation({id:o.repositoryId,full_name:o.fullName,html_url:o.htmlUrl},o.observedAt,o.source))throw new TypeError('invalid identity observation');
 const ordered=observations.map((o,i)=>({o,i})).sort((a,b)=>Number(a.o.source==='repository_metadata')-Number(b.o.source==='repository_metadata')||a.o.observedAt.localeCompare(b.o.observedAt)||a.i-b.i);
 const latest=ordered.at(-1)!.o;const metadataNames=new Set(observations.filter(o=>o.source==='repository_metadata').map(o=>o.fullName));
 const conflicts=metadataNames.size&&observations.some(o=>!metadataNames.has(o.fullName))?['search_metadata_name_disagreement']:[];
 return{provider:'github',repositoryId:latest.repositoryId,completeness:conflicts.length?'incomplete':'provider_id',fullName:latest.fullName,aliases:[...new Set(observations.map(o=>o.fullName))].filter(n=>n!==latest.fullName).sort(),htmlUrl:latest.htmlUrl,observations:structuredClone(observations),conflicts,revision:{state:'unresolved',sha:null}};
}
/** Discovery-only v2 does not weaken v1: resolution must happen in a later adapter. */
export function comparisonIdentity(candidate:SearchIdentity):SnapshotIdentity {
 validateSearchIdentity(candidate);throw new TypeError('candidate revision unresolved; comparison prohibited');
}
function closed(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw new TypeError('invalid discovery v2 shape');}
function validateSearchIdentity(value:unknown):asserts value is SearchIdentity {
 closed(value,['provider','repositoryId','completeness','fullName','aliases','htmlUrl','observations','conflicts','revision']);const v=value as unknown as SearchIdentity;
 if(v.provider!=='github'||!Array.isArray(v.observations)||!v.observations.length||!Array.isArray(v.conflicts)||v.conflicts.some(c=>!['search_metadata_name_disagreement','name_id_collision'].includes(c)))throw new TypeError('invalid search identity');
 for(const o of v.observations){closed(o,['repositoryId','fullName','htmlUrl','source','observedAt']);if(!['repository_search','repository_metadata'].includes(o.source))throw new TypeError('invalid identity source');}
 const merged=mergeIdentity(v.observations);if(v.repositoryId!==merged.repositoryId||v.fullName!==merged.fullName||v.htmlUrl!==merged.htmlUrl||JSON.stringify(v.aliases)!==JSON.stringify(merged.aliases)||v.completeness!==(v.conflicts.length?'incomplete':'provider_id')||merged.conflicts.some(c=>!v.conflicts.includes(c)))throw new TypeError('identity provenance mismatch');
 closed(v.revision,['state','sha']);if(v.revision.state!=='unresolved'||v.revision.sha!==null)throw new TypeError('invalid unresolved revision');
}
export function validateSearchCandidate(value:unknown):asserts value is SearchCandidate {
 closed(value,['schemaVersion','target','candidate','discoveries','similarity','supportingFiles','verification','lineageClaim','comparison']);const c=value as unknown as SearchCandidate;
 validateIdentity(c.target);validateSearchIdentity(c.candidate);closed(c.verification,['state','canonicalEvidenceIds']);closed(c.comparison,['state','reason']);
 if(c.schemaVersion!=='discovery-candidate@2'||c.lineageClaim!=='none'||c.verification.state!=='pending'||!Array.isArray(c.verification.canonicalEvidenceIds)||c.verification.canonicalEvidenceIds.length||!Array.isArray(c.similarity)||c.similarity.length||!Array.isArray(c.supportingFiles)||c.supportingFiles.length||c.comparison.state!=='unexecuted'||c.comparison.reason!=='revision unresolved'||!Array.isArray(c.discoveries)||!c.discoveries.length)throw new TypeError('invalid discovery-only candidate');
 for(const d of c.discoveries){closed(d,['source','version','query','querySource','reason','page','rank','observedAt']);if(d.source!=='repository_search'||d.version!=='github-rest-repository-search@1'||typeof d.query!=='string'||d.query.length>200||typeof d.reason!=='string'||d.reason.length>150||!['repository_name','description','topic','explicit_keyword'].includes(d.querySource)||!Number.isSafeInteger(d.page)||d.page<1||d.page>2||!Number.isSafeInteger(d.rank)||d.rank<1||d.rank>50||!c.candidate.observations.some(o=>o.source===d.source&&o.observedAt===d.observedAt))throw new TypeError('invalid discovery reason');}
}
