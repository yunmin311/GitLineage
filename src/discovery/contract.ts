import type { BudgetUsage } from './budget.ts';
export type Completion = 'completed' | 'partial' | 'unavailable' | 'unexecuted';
export interface SnapshotIdentity {
  provider: 'github' | 'synthetic'; repositoryId: number | null;
  completeness: 'provider_id' | 'name_only' | 'synthetic'; fullName: string; aliases: string[];
  /** SHA of an actual Git commit, including locally constructed synthetic fixtures. */
  revision: string;
}
export type FileClass = 'application_source' | 'vendor' | 'generated' | 'minified' | 'lockfile' | 'license' | 'documentation' | 'template' | 'too_small' | 'unsupported' | 'unclassified';
export interface FileRecord {
  path: string; digest: string; blob: string; bytes: number; language: 'javascript' | 'typescript' | 'unknown';
  parserVersion: string; filterVersion: string; classification: FileClass; reasons: string[];
}
export interface Check { kind: string; state: Completion; reasons: string[] }
export interface MatchRange { first: [number,number]; second: [number,number]; firstChars: [number,number]; secondChars: [number,number]; fingerprint: string }
export interface Measurement {
  method: 'exact_blob' | 'strict_token5' | 'normalized_token5'; version: string; parserVersion: string; filterVersion: string;
  state: Completion; score: number | null; firstPath: string; secondPath: string;
  firstDigest: string; secondDigest: string; firstTokens: number | null; secondTokens: number | null;
  sharedShingles: number | null; firstShingles: number | null; secondShingles: number | null;
  firstCoverage: number | null; secondCoverage: number | null; ranges: MatchRange[]; rangesTruncated: boolean; reasons: string[];
}
export interface DiscoveryCandidate {
  schemaVersion: 'discovery-candidate@1'; target: SnapshotIdentity; candidate: SnapshotIdentity;
  discoveries: {source:string;version:string;reason:string;locator:string}[];
  similarity: Measurement[]; files: { target: FileRecord[]; candidate: FileRecord[] }; checks: Check[];
  verification: {state:'pending'|'checked'|'inconclusive'|'rejected';checks:Check[];canonicalEvidenceIds:string[]};
  lineageClaim: 'none'; coverage: {state:Completion;expectedPairs:number;comparedPairs:number;pending:string[];reasons:string[]};
  usage: BudgetUsage;
}
// Small closed-shape validator: no dependencies, coercion, unknown keys or implicit defaults.
type Rule = (v:unknown,p:string)=>void;
const fail=(p:string):never=>{throw new TypeError(`invalid Discovery candidate: ${p}`);};
const string:Rule=(v,p)=>{if(typeof v!=='string'||!v.length)fail(p);};
const count:Rule=(v,p)=>{if(!Number.isSafeInteger(v)||Number(v)<0)fail(p);};
const score:Rule=(v,p)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)fail(p);};
const bool:Rule=(v,p)=>{if(typeof v!=='boolean')fail(p);};
const nullable=(r:Rule):Rule=>(v,p)=>{if(v!==null)r(v,p);};
const enumeration=(...values:string[]):Rule=>(v,p)=>{if(!values.includes(v as string))fail(p);};
const array=(r:Rule):Rule=>(v,p)=>{if(!Array.isArray(v))fail(p);(v as unknown[]).forEach((x,i)=>r(x,`${p}[${i}]`));};
const object=(fields:Record<string,Rule>):Rule=>(v,p)=>{
  if(v===null||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)fail(p);
  const record=v as Record<string,unknown>;
  for(const k of Object.keys(record))if(!Object.hasOwn(fields,k))fail(`${p}.${k}`);
  for(const [k,r] of Object.entries(fields))r(record[k],`${p}.${k}`);
};
const dict:Rule=(v,p)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(p);for(const [k,x]of Object.entries(v!))count(x,`${p}.${k}`);};
const regex=(expression:RegExp):Rule=>(v,p)=>{string(v,p);if(!expression.test(v as string))fail(p);};
const revision=regex(/^[a-f0-9]{40}$/), digest=regex(/^[a-f0-9]{64}$/);
const path:Rule=(v,p)=>{string(v,p);if((v as string).startsWith('/')||(v as string).includes('\\')||(v as string).split('/').some(x=>!x||x==='.'||x==='..'))fail(p);};
const state=enumeration('completed','partial','unavailable','unexecuted');
const check=object({kind:string,state,reasons:array(string)});
const range:Rule=(v,p)=>{if(!Array.isArray(v)||v.length!==2)fail(p);count((v as number[])[0],p);count((v as number[])[1],p);if((v as number[])[0]! >= (v as number[])[1]!)fail(p);};
const identity=object({provider:enumeration('github','synthetic'),repositoryId:nullable(count),completeness:enumeration('provider_id','name_only','synthetic'),fullName:regex(/^[\w.-]+\/[\w.-]+$/),aliases:array(regex(/^[\w.-]+\/[\w.-]+$/)),revision});
const file=object({path,digest,blob:revision,bytes:count,language:enumeration('javascript','typescript','unknown'),parserVersion:string,filterVersion:string,
  classification:enumeration('application_source','vendor','generated','minified','lockfile','license','documentation','template','too_small','unsupported','unclassified'),reasons:array(string)});
const measurement=object({method:enumeration('exact_blob','strict_token5','normalized_token5'),version:string,parserVersion:string,filterVersion:string,state,score:nullable(score),
  firstPath:path,secondPath:path,firstDigest:digest,secondDigest:digest,firstTokens:nullable(count),secondTokens:nullable(count),sharedShingles:nullable(count),firstShingles:nullable(count),secondShingles:nullable(count),firstCoverage:nullable(score),secondCoverage:nullable(score),
  ranges:array(object({first:range,second:range,firstChars:range,secondChars:range,fingerprint:digest})),rangesTruncated:bool,reasons:array(string)});
export const validateUsage:Rule=object({attempts:count,searchAttempts:count,candidates:count,files:dict,bytesByFile:dict,totalBytes:count,activeWorkers:count,peakWorkers:count});
const candidateRule=object({schemaVersion:enumeration('discovery-candidate@1'),target:identity,candidate:identity,
  discoveries:array(object({source:string,version:string,reason:string,locator:string})),similarity:array(measurement),files:object({target:array(file),candidate:array(file)}),checks:array(check),
  verification:object({state:enumeration('pending','checked','inconclusive','rejected'),checks:array(check),canonicalEvidenceIds:array(string)}),lineageClaim:enumeration('none'),
  coverage:object({state,expectedPairs:count,comparedPairs:count,pending:array(string),reasons:array(string)}),usage:validateUsage});
export function validateIdentity(v:unknown):asserts v is SnapshotIdentity {
  identity(v,'identity');const i=v as SnapshotIdentity;
  if(i.provider==='synthetic' ? i.completeness!=='synthetic'||i.repositoryId!==null :
    i.completeness==='synthetic'||(i.completeness==='provider_id' ? i.repositoryId===null||i.repositoryId===0 : i.repositoryId!==null))fail('identity completeness');
}
export function validateCandidate(v:unknown):asserts v is DiscoveryCandidate {
  candidateRule(v,'candidate'); const c=v as DiscoveryCandidate;validateIdentity(c.target);validateIdentity(c.candidate);
  if(!c.discoveries.length)fail('discovery reasons required');
  for(const side of ['target','candidate'] as const){const paths=c.files[side].map(f=>f.path);if(new Set(paths).size!==paths.length)fail('duplicate file');}
  for(const m of c.similarity){
    const a=c.files.target.find(f=>f.path===m.firstPath),b=c.files.candidate.find(f=>f.path===m.secondPath);
    if(!a||!b||a.digest!==m.firstDigest||b.digest!==m.secondDigest||a.classification!=='application_source'||b.classification!=='application_source')fail('measurement file binding');
    if(m.state!=='completed' ? m.score!==null||m.ranges.length>0 : m.score===null)fail('score completion');
    if(m.method==='exact_blob'&&m.score!==null&&m.score!==0&&m.score!==1)fail('exact score');
    if(m.state==='completed'&&m.method!=='exact_blob'){
      if(m.firstTokens===null||m.secondTokens===null||m.sharedShingles===null||!m.firstShingles||!m.secondShingles)fail('missing denominator');
      const shared=m.sharedShingles!,first=m.firstShingles!,second=m.secondShingles!;
      if(shared>Math.min(first,second)||m.score!==shared/(first+second-shared)||m.firstCoverage!==shared/first||m.secondCoverage!==shared/second)fail('inconsistent score');
    }
    for(const r of m.ranges){if(r.first[1]>m.firstTokens!||r.second[1]>m.secondTokens!||r.firstChars[1]>a!.bytes||r.secondChars[1]>b!.bytes)fail('range bounds');}
  }
  if(c.coverage.comparedPairs>c.coverage.expectedPairs||c.coverage.state==='completed'&&(c.coverage.comparedPairs!==c.coverage.expectedPairs||c.coverage.pending.length))fail('coverage');
  if(c.verification.canonicalEvidenceIds.length)fail('Phase 1A has no canonical evidence adapter');
  if(c.verification.state==='checked'&&(!c.verification.checks.length||c.verification.checks.some(x=>x.state!=='completed')))fail('checks unfinished');
  if(c.usage.searchAttempts>c.usage.attempts||c.usage.activeWorkers>c.usage.peakWorkers)fail('usage');
}
