/** Metadata-only recommendation. Never fetches, parses or invents unseen content. */
import type {SourceDirectory,ListedFile} from './source-selection.ts';
export const SELECTION_VERSION='representative-source-selection@1';
export function moduleOf(path:string):string {const parts=path.split('/');return parts.length===1?'(root)':parts.length>2?parts.slice(0,2).join('/'):parts[0]!;}
export interface RecommendationLimits {attempts:number;usedAttempts:number;reservedBytes:number;totalResponseBytes:number;perResponseBytes:number;totalBytes:number;usedBytes:number;filesPerRepository:number;maxRecommended?:number}
export interface RecommendedFile {path:string;blob:string;bytes:number;module:string;language:string;reason:string}
export interface Recommendation {schemaVersion:typeof SELECTION_VERSION;scope:string;estimatedRequests:number;selectedBytes:number;reasons:string[];repositories:{repositoryId:number;selected:RecommendedFile[];listedModules:string[];uncoveredModules:string[];unlistedDirectories:string[];notRecommended:{path:string;reason:string}[]}[]}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const noise=(f:ListedFile)=> /(^|\/)(__tests__|tests?|fixtures?|examples?)(\/|$)|(^|\/)([^/]*[.-])?(config|setup|spec|test)[.-]|\.d\.ts$/.test(f.path)?1:0;
export function recommendSources(repositories:SourceDirectory[],limits:RecommendationLimits):Recommendation {
 const out:Recommendation={schemaVersion:SELECTION_VERSION,scope:'bounded listing metadata only; content quality is unknown until digest-checked reads; repository-wide coverage unknown',estimatedRequests:0,selectedBytes:0,reasons:[],repositories:[]};
 const max=Math.min(8,limits.filesPerRepository,limits.maxRecommended??3);
 // Every repository needs a fresh final identity check. Failed requests retain their cost.
 let reads=Math.max(0,Math.min(limits.attempts-limits.usedAttempts,Math.floor((limits.totalResponseBytes-limits.reservedBytes)/limits.perResponseBytes))-repositories.length),bytes=Math.max(0,limits.totalBytes-limits.usedBytes);
 const pools=repositories.map(r=>r.files.filter(f=>f.selectable&&f.language!=='unsupported'&&f.bytes!==null&&f.bytes>=20&&f.bytes<=24000));
 out.repositories=repositories.map(r=>({repositoryId:r.repositoryId,selected:[],listedModules:[...new Set(r.files.filter(f=>f.selectable&&f.language!=='unsupported').map(f=>moduleOf(f.path)))].sort(compare),uncoveredModules:[],unlistedDirectories:[...r.coverage.unlistedDirectories].sort(compare),notRecommended:[]}));
 // Round-robin repository allocation prevents the target from consuming all read slots.
 for(let round=0;round<max&&reads>0;round++)for(let i=0;i<repositories.length&&reads>0;i++){
  const r=out.repositories[i]!,seenModules=new Set(r.selected.map(f=>f.module)),seenLanguages=new Set(r.selected.map(f=>f.language)),seenBlobs=new Set(r.selected.map(f=>f.blob));
  const available=pools[i]!.filter(f=>!r.selected.some(s=>s.path===f.path)&&!seenBlobs.has(f.blob)&&f.bytes!<=bytes);
  available.sort((a,b)=>noise(a)-noise(b)||Number(a.bytes!<80)-Number(b.bytes!<80)||Number(seenModules.has(moduleOf(a.path)))-Number(seenModules.has(moduleOf(b.path)))||Number(seenLanguages.has(a.language))-Number(seenLanguages.has(b.language))||a.bytes!-b.bytes!||compare(a.path,b.path));
  const f=available[0];if(!f)continue;
  r.selected.push({path:f.path,blob:f.blob,bytes:f.bytes!,module:moduleOf(f.path),language:f.language,reason:`module ${moduleOf(f.path)}; ${seenModules.has(moduleOf(f.path))?'additional':'new'} module; ${seenLanguages.has(f.language)?'known':'new'} ${f.language}; ${f.bytes} bytes; content not yet read`});reads--;bytes-=f.bytes!;out.selectedBytes+=f.bytes!;
 }
 for(let i=0;i<repositories.length;i++){const r=out.repositories[i]!;r.uncoveredModules=r.listedModules.filter(m=>!r.selected.some(f=>f.module===m));r.notRecommended=repositories[i]!.files.filter(f=>!r.selected.some(s=>s.path===f.path)).map(f=>({path:f.path,reason:!f.selectable?f.reason:f.language==='unsupported'?'unsupported language; not compared':r.selected.some(s=>s.blob===f.blob)?'duplicate listed Git blob; manual override available':'sampling/size/request budget or lower metadata priority; content not read'})).sort((a,b)=>compare(a.path,b.path));}
 const selected=out.repositories.reduce((n,r)=>n+r.selected.length,0);out.estimatedRequests=selected?selected+repositories.length:0;
 if(out.repositories.some(r=>!r.selected.length))out.reasons.push('insufficient budget or eligible sources for every repository; manual review required');
 out.reasons.push('Recommendation is optional; manual paths remain authoritative. Generated markers, parser failures and low-information content are checked only after reading.');return out;
}
