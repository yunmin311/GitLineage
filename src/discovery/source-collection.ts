import {createHash} from 'node:crypto';
import {fullSHA,record,validateResolution} from './resolution.ts';
import type {Resolution} from './resolution.ts';
import type {RepositorySnapshotResolver} from './resolution.ts';
import {classify,gitBlob,sha256,FILTER_VERSION,PARSER_VERSION} from './snapshot.ts';
import type {SourceSnapshot} from './snapshot.ts';
import type {FileRecord} from './contract.ts';
export interface SourceSelection {path:string;reason:string;expectedDigest?:string}
export interface SourceBinding {repositoryId:number;revision:string;path:string;blob:string;digest:string;bytes:number;parserVersion:string;filterVersion:string}
export interface CollectedSources {snapshot:SourceSnapshot|null;selections:SourceSelection[];bindings:SourceBinding[];materializedBytes:number;coverage:{scope:'explicit selected paths only';state:'completed'|'partial'|'unavailable';treeTruncated:boolean;reasons:string[];pending:string[]}}
export interface TreeEntry {path:string;mode:string;type:string;sha:string;size?:number}
/** Nonrecursive Git tree hash. API order is not authoritative: Git sorts directories
 * with a trailing slash and hashes raw mode/name/NUL/object-ID bytes. */
export function gitTree(entries:TreeEntry[]):string {
 const ordered=[...entries].sort((a,b)=>Buffer.compare(Buffer.from(a.path+(a.type==='tree'?'/':'')),Buffer.from(b.path+(b.type==='tree'?'/':''))));
 const raw=Buffer.concat(ordered.map(e=>Buffer.concat([Buffer.from(`${e.mode.replace(/^0+/, '')} ${e.path}\0`),Buffer.from(e.sha,'hex')])));
 return createHash('sha1').update(`tree ${raw.length}\0`).update(raw).digest('hex');
}
export interface ValidatedTree {entries:TreeEntry[];truncated:boolean}
export type TreeCache=Map<string,ValidatedTree>;
export function parseTree(raw:unknown,sha:string):ValidatedTree {
 const data=record(raw);if(data.sha!==sha||typeof data.truncated!=='boolean'||!Array.isArray(data.tree)||data.tree.length>4096)throw new Error('tree identity or shape mismatch');
  const entries:TreeEntry[]=[],seen=new Set<string>();for(const value of data.tree){const e=record(value);if(typeof e.path!=='string'||!e.path.length||e.path.includes('/')||e.path.includes('\\')||['.','..'].includes(e.path)||/[\x00-\x1f]/.test(e.path)||seen.has(e.path)||!fullSHA(e.sha)||typeof e.mode!=='string'||!['100644','100755','040000','40000','120000','160000'].includes(e.mode)||!['blob','tree','commit'].includes(String(e.type)))throw new Error('invalid tree entry');seen.add(e.path);
   if((e.type==='tree')!==['040000','40000'].includes(e.mode)||(e.type==='commit')!==(e.mode==='160000'))throw new Error('tree mode/type mismatch');
   const entry:TreeEntry={path:e.path,mode:e.mode,type:String(e.type),sha:e.sha};if(e.size!==undefined){if(!Number.isSafeInteger(e.size)||Number(e.size)<0)throw new Error('invalid tree byte count');entry.size=Number(e.size);}entries.push(entry);}
 if(!data.truncated&&gitTree(entries)!==sha)throw new Error('Git tree digest mismatch');return {entries,truncated:data.truncated};
}
export function validateSelections(selections:SourceSelection[]):void {
 if(!Array.isArray(selections)||selections.length>8)throw new TypeError('at most eight explicit paths');
 const seen=new Set<string>();for(const item of selections){if(!item||Object.keys(item).some(k=>!['path','reason','expectedDigest'].includes(k))||typeof item.path!=='string'||item.path.length>256||item.path.includes('\\')||item.path.split('/').length>4||item.path.split('/').some(x=>!x||x==='.'||x==='..'||/[\x00-\x1f]/.test(x))||typeof item.reason!=='string'||!item.reason.length||item.reason.length>150||seen.has(item.path)||item.expectedDigest!==undefined&&!/^[a-f0-9]{64}$/.test(item.expectedDigest))throw new TypeError('invalid source selection');seen.add(item.path);}
}
export async function collectSources(resolution:Resolution,selections:SourceSelection[],resolver:RepositorySnapshotResolver,verifiedTrees?:TreeCache):Promise<CollectedSources>{
 validateResolution(resolution);validateSelections(selections);
 const out:CollectedSources={snapshot:null,selections:structuredClone(selections),bindings:[],materializedBytes:0,coverage:{scope:'explicit selected paths only',state:'unavailable',treeTruncated:false,reasons:[],pending:[]}};
 if(!resolution.identity||!resolution.tree){out.coverage.reasons.push(...resolution.reasons);out.coverage.pending=selections.map(s=>s.path);return out;}
 const identity=resolution.identity,snapshot:SourceSnapshot={identity:structuredClone(identity),files:[],sources:[],state:'completed',pending:[],reasons:[]};out.snapshot=snapshot;
 const key=`github:${resolution.requestedId}@${identity.revision}`,trees=new Map<string,TreeEntry[]>();
 async function tree(sha:string):Promise<TreeEntry[]>{
  const cached=trees.get(sha);if(cached)return cached;
  const retained=verifiedTrees?.get(`${resolution.requestedId}:${sha}`);
  const raw=retained?{sha,truncated:retained.truncated,tree:retained.entries}:await resolver.provider.get(resolver.objectEndpoint(resolution,'trees',sha),resolver.network);if(!raw)throw new Error(`tree: ${resolver.provider.failure()}`);const data=record(raw);
  if(data.sha!==sha||typeof data.truncated!=='boolean'||!Array.isArray(data.tree)||data.tree.length>4096)throw new Error('tree identity or shape mismatch');
  const {entries}=parseTree(data,sha);
  if(data.truncated){out.coverage.treeTruncated=true;out.coverage.reasons.push(`tree truncated: ${sha}`);snapshot.state='partial';snapshot.reasons.push(`tree truncated: ${sha}`);}else if(gitTree(entries)!==sha)throw new Error('Git tree digest mismatch');
  trees.set(sha,entries);return entries;
 }
 for(const selection of [...selections].sort((a,b)=>a.path<b.path?-1:1)){
  try{
   resolver.network.budget.guard();const parts=selection.path.split('/');let hash=resolution.tree;let entry:TreeEntry|undefined;
   for(let i=0;i<parts.length;i++){entry=(await tree(hash)).find(e=>e.path===parts[i]);if(!entry)throw new Error('selected path unavailable');if(i<parts.length-1){if(entry.type!=='tree')throw new Error('selected directory unavailable');hash=entry.sha;}}
   if(!entry||entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||entry.size===undefined)throw new Error('selected path is not a regular sized source blob');
   resolver.network.budget.file(key,selection.path);resolver.network.budget.bytes(key,selection.path,entry.size);
   const raw=await resolver.provider.get(resolver.objectEndpoint(resolution,'blobs',entry.sha),resolver.network);if(!raw)throw new Error(`blob: ${resolver.provider.failure()}`);const b=record(raw);
   if(b.sha!==entry.sha||b.size!==entry.size||b.encoding!=='base64'||typeof b.content!=='string')throw new Error('blob identity or byte count mismatch');
   const encoded=b.content.replace(/\n/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)||encoded.length!==4*Math.ceil(entry.size/3))throw new Error('invalid bounded base64');
   const bytes=Buffer.from(encoded,'base64');out.materializedBytes+=bytes.length;
   if(bytes.length!==entry.size||gitBlob(bytes)!==entry.sha)throw new Error('Git blob digest mismatch');const digest=sha256(bytes);if(selection.expectedDigest!==undefined&&digest!==selection.expectedDigest)throw new Error('SHA-256 digest mismatch');
   const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes),filter=classify(selection.path,content);
   const file:FileRecord={path:selection.path,digest,blob:entry.sha,bytes:bytes.length,language:/\.[cm]?js$/.test(selection.path)?'javascript':/\.[cm]?ts$/.test(selection.path)?'typescript':'unknown',parserVersion:PARSER_VERSION,filterVersion:FILTER_VERSION,...filter};
   snapshot.files.push(file);out.bindings.push({repositoryId:resolution.requestedId,revision:identity.revision,path:file.path,blob:file.blob,digest:file.digest,bytes:file.bytes,parserVersion:file.parserVersion,filterVersion:file.filterVersion});
   if(file.classification==='application_source')snapshot.sources.push({record:file,content});else out.coverage.reasons.push(`${file.path}: filtered ${file.classification}: ${file.reasons.join('; ')}`);
  }catch(error){const reason=error instanceof TypeError?'invalid UTF-8 or provider object':error instanceof Error?error.message:'source collection failed';snapshot.state='partial';snapshot.pending.push(selection.path);snapshot.reasons.push(`${selection.path}: ${reason}`);}
 }
 out.coverage.pending=[...snapshot.pending];out.coverage.reasons.push(...snapshot.reasons);out.coverage.state=snapshot.state==='partial'?'partial':snapshot.sources.length?'completed':'unavailable';
 if(!snapshot.sources.length)out.coverage.reasons.push('no eligible selected source');return out;
}
