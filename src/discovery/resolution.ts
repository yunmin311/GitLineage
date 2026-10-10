import {OFFLINE_PROFILE} from './budget.ts';
import type {BudgetProfile} from './budget.ts';
import {NetworkLedger} from './network.ts';
import {SnapshotProvider} from './snapshot-provider.ts';
import type {ProviderOptions} from './search-provider.ts';
import {parseObservation,mergeIdentity} from './search-contract.ts';
import type {IdentityObservation} from './search-contract.ts';
import {validateIdentity} from './contract.ts';
import type {SnapshotIdentity} from './contract.ts';
export const SNAPSHOT_PROFILE:Readonly<BudgetProfile>=Object.freeze({...OFFLINE_PROFILE,attempts:24,searchAttempts:4,candidates:3,filesPerCandidate:8,bytesPerFile:131072});
export const SNAPSHOT_NETWORK=Object.freeze({perResponseBytes:32768,totalResponseBytes:1048576});
export function checkSnapshotProfile(profile:BudgetProfile):void{for(const key of Object.keys(SNAPSHOT_PROFILE) as (keyof BudgetProfile)[])if(key!=='cpuMs'&&profile[key]!>SNAPSHOT_PROFILE[key]!)throw new TypeError(`snapshot ceiling exceeded: ${key}`);}
export const fullSHA=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('invalid provider object');return value as Record<string,unknown>;}
export interface Resolution {schemaVersion:'repository-snapshot@1';requestedId:number;state:'resolved'|'inconclusive';identity:SnapshotIdentity|null;observations:IdentityObservation[];defaultBranch:string|null;tree:string|null;parents:string[];metadata:{fork:boolean|null;parentId:number|null};reasons:string[];requestSource:'github-rest-id-scoped@1'|'github-rest-verified-name@1'}
function closed(v:unknown,keys:string[]):Record<string,unknown>{const r=record(v);if(Object.keys(r).sort().join(',')!==keys.sort().join(','))throw new TypeError('invalid resolution shape');return r;}
export function validateResolution(value:unknown):asserts value is Resolution {
 const r=closed(value,['schemaVersion','requestedId','state','identity','observations','defaultBranch','tree','parents','metadata','reasons','requestSource']);
 if(r.schemaVersion!=='repository-snapshot@1'||!['github-rest-id-scoped@1','github-rest-verified-name@1'].includes(String(r.requestSource))||!Number.isSafeInteger(r.requestedId)||Number(r.requestedId)<1||!['resolved','inconclusive'].includes(String(r.state))||!Array.isArray(r.observations)||!Array.isArray(r.parents)||!r.parents.every(fullSHA)||!Array.isArray(r.reasons)||!r.reasons.every(x=>typeof x==='string'&&x.length))throw new TypeError('invalid resolution');
 const m=closed(r.metadata,['fork','parentId']);if(m.fork!==null&&typeof m.fork!=='boolean'||m.parentId!==null&&(!Number.isSafeInteger(m.parentId)||Number(m.parentId)<1))throw new TypeError('invalid metadata');
 if(r.defaultBranch!==null&&(typeof r.defaultBranch!=='string'||!r.defaultBranch.length||r.defaultBranch.length>255))throw new TypeError('invalid branch');
 for(const o of r.observations){const p=closed(o,['repositoryId','fullName','htmlUrl','source','observedAt']);if(p.repositoryId!==r.requestedId||!parseObservation({id:p.repositoryId,full_name:p.fullName,html_url:p.htmlUrl},String(p.observedAt),p.source==='repository_metadata'?'repository_metadata':'repository_search')||!['repository_metadata','repository_search'].includes(String(p.source)))throw new TypeError('invalid observation');}
 if(r.state==='resolved'){
  validateIdentity(r.identity);const i=r.identity;if(i.provider!=='github'||i.completeness!=='provider_id'||i.repositoryId!==r.requestedId||!fullSHA(r.tree)||!r.defaultBranch||!r.observations.length)throw new TypeError('invalid pinned identity');
  const merged=mergeIdentity(r.observations);if(!r.observations.some(o=>o.source==='repository_metadata')||i.fullName!==merged.fullName||JSON.stringify(i.aliases)!==JSON.stringify(merged.aliases))throw new TypeError('resolution provenance mismatch');
 }else if(r.identity!==null||r.tree!==null||!r.reasons.length)throw new TypeError('invalid unresolved state');
}
export class RepositorySnapshotResolver {
 readonly provider:SnapshotProvider;private historical:boolean;private now:()=>string;readonly network:NetworkLedger;
 constructor(network:NetworkLedger,options:ProviderOptions&{now?:()=>string;historicalRoutes?:boolean}={}){this.historical=options.historicalRoutes===true;this.network=network;this.now=options.now??(()=>new Date().toISOString());this.provider=new SnapshotProvider(options,this.now);}
 objectEndpoint(resolution:Resolution,kind:'trees'|'blobs',sha:string):string {validateResolution(resolution);if(!resolution.identity||!fullSHA(sha))throw new TypeError('unresolved object identity');return `${resolution.requestSource==='github-rest-id-scoped@1'?`/repositories/${resolution.requestedId}`:`/repos/${resolution.identity.fullName}`}/git/${kind}/${sha}`;}
 async resolve(id:number,observations:IdentityObservation[]=[],expectedRevision?:string):Promise<Resolution>{
  if(!Number.isSafeInteger(id)||id<1||expectedRevision!==undefined&&!fullSHA(expectedRevision))throw new TypeError('invalid requested identity');
  const r:Resolution={schemaVersion:'repository-snapshot@1',requestedId:id,state:'inconclusive',identity:null,observations:structuredClone(observations),defaultBranch:null,tree:null,parents:[],metadata:{fork:null,parentId:null},reasons:[],requestSource:this.historical?'github-rest-id-scoped@1':'github-rest-verified-name@1'};
  try{
   if(observations.some(o=>o.repositoryId!==id))throw new Error('repository ID mismatch');
   const raw=await this.provider.get(`/repositories/${id}`,this.network);if(!raw)throw new Error(`metadata: ${this.provider.failure()}`);const m=record(raw);
   if(m.id!==id)throw new Error('repository ID mismatch');const observed=parseObservation(m,this.now(),'repository_metadata');if(!observed)throw new Error('invalid metadata identity');r.observations.push(observed);
   if(typeof m.default_branch!=='string'||!m.default_branch.length||m.default_branch.length>255||/[\x00-\x1f]/.test(m.default_branch))throw new Error('default branch unavailable');r.defaultBranch=m.default_branch;
   r.metadata={fork:typeof m.fork==='boolean'?m.fork:null,parentId:m.parent&&Number.isSafeInteger(record(m.parent).id)&&Number(record(m.parent).id)>0?Number(record(m.parent).id):null};
   const commit=await this.provider.get(`${this.historical?`/repositories/${id}`:`/repos/${observed.fullName}`}/commits/${encodeURIComponent(expectedRevision??r.defaultBranch)}`,this.network);if(!commit)throw new Error(`commit: ${this.provider.failure()}`);const c=record(commit),tree=record(record(c.commit).tree).sha;
   if(!fullSHA(c.sha)||!fullSHA(tree)||expectedRevision&&c.sha!==expectedRevision)throw new Error('invalid full commit or tree SHA');
   if(!Array.isArray(c.parents)||c.parents.some(p=>!fullSHA(record(p).sha)))throw new Error('invalid commit parents');
   const merged=mergeIdentity(r.observations);r.identity={provider:'github',repositoryId:id,completeness:'provider_id',fullName:merged.fullName,aliases:merged.aliases,revision:c.sha};r.tree=tree;r.parents=c.parents.map(p=>String(record(p).sha));r.state='resolved';
   if(merged.conflicts.length)r.reasons.push(...merged.conflicts);
  }catch(error){r.state='inconclusive';r.identity=null;r.tree=null;r.reasons.push(error instanceof TypeError?'invalid full commit or tree SHA':error instanceof Error?error.message:'resolution failed');}
  validateResolution(r);return r;
 }
}
export type TimelessResolution=Omit<Resolution,'observations'>&{observations:Omit<IdentityObservation,'observedAt'>[]};
/** Persisted resolution observations have no fabricated clocks. Metadata is the
 * final ID-scoped observation; aliases are exactly the other observed names. */
export function validateTimelessResolution(value:unknown):asserts value is TimelessResolution {
 const r=closed(value,['schemaVersion','requestedId','state','identity','observations','defaultBranch','tree','parents','metadata','reasons','requestSource']);
 if(r.schemaVersion!=='repository-snapshot@1'||!['github-rest-id-scoped@1','github-rest-verified-name@1'].includes(String(r.requestSource))||!Number.isSafeInteger(r.requestedId)||Number(r.requestedId)<1||!['resolved','inconclusive'].includes(String(r.state))||!Array.isArray(r.observations)||!Array.isArray(r.parents)||!r.parents.every(fullSHA)||!Array.isArray(r.reasons)||!r.reasons.every(x=>typeof x==='string'&&x.length))throw new TypeError('invalid timeless resolution');
 const m=closed(r.metadata,['fork','parentId']);if(m.fork!==null&&typeof m.fork!=='boolean'||m.parentId!==null&&(!Number.isSafeInteger(m.parentId)||Number(m.parentId)<1))throw new TypeError('invalid metadata');
 if(r.defaultBranch!==null&&(typeof r.defaultBranch!=='string'||!r.defaultBranch.length||r.defaultBranch.length>255))throw new TypeError('invalid branch');
 const names:string[]=[],metadataNames:string[]=[];for(const value of r.observations){const o=closed(value,['repositoryId','fullName','htmlUrl','source']);if(o.repositoryId!==r.requestedId||typeof o.fullName!=='string'||! /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(o.fullName)||['.','..'].includes(o.fullName.split('/')[1]!)||o.htmlUrl!==`https://github.com/${o.fullName}`||!['repository_search','repository_metadata'].includes(String(o.source)))throw new TypeError('invalid timeless observation');names.push(o.fullName);if(o.source==='repository_metadata')metadataNames.push(o.fullName);}
 if(r.state==='resolved'){validateIdentity(r.identity);const i=r.identity;if(i.provider!=='github'||i.completeness!=='provider_id'||i.repositoryId!==r.requestedId||!fullSHA(r.tree)||!r.defaultBranch||metadataNames.at(-1)!==i.fullName||JSON.stringify(i.aliases)!==JSON.stringify([...new Set(names)].filter(n=>n!==i.fullName).sort()))throw new TypeError('invalid timeless provenance');}
 else if(r.identity!==null||r.tree!==null||!r.reasons.length)throw new TypeError('invalid unresolved state');
}
