/** Bounded non-recursive object traversal, pinned to verified commit/tree identities. */
import {parseTree} from '../../src/discovery/source-collection.ts';
import type {TreeCache} from '../../src/discovery/source-collection.ts';
import type {Resolution,RepositorySnapshotResolver} from '../../src/discovery/resolution.ts';
import {classify} from '../../src/discovery/snapshot.ts';
export interface ListedFile {path:string;type:string;bytes:number|null;blob:string;selectable:boolean;reason:string;language:'javascript'|'typescript'|'unsupported'}
export interface SourceDirectory {repositoryId:number;revision:string|null;tree:string|null;fullName:string;files:ListedFile[];coverage:{scope:'bounded tree listing, not a repository scan';state:'listed'|'partial'|'unavailable';enumeration:'complete'|'partial'|'failed'|'unavailable';eligibleFiles:number;visitedTrees:number;unlistedDirectories:string[];filtered:{path:string;reason:string}[];reasons:string[]}}
export async function listSources(resolution:Resolution,resolver:RepositorySnapshotResolver,cache:TreeCache):Promise<SourceDirectory> {
 const out:SourceDirectory={repositoryId:resolution.requestedId,revision:resolution.identity?.revision??null,tree:resolution.tree,fullName:resolution.identity?.fullName??resolution.observations.at(-1)?.fullName??'unresolved',files:[],coverage:{scope:'bounded tree listing, not a repository scan',state:'unavailable',enumeration:'unavailable',eligibleFiles:0,visitedTrees:0,unlistedDirectories:[],filtered:[],reasons:[...resolution.reasons]}};
 if(!resolution.identity||!resolution.tree)return out;
 let successfulTrees=0;const queue=[{path:'',sha:resolution.tree,depth:0}];
 while(queue.length&&out.coverage.visitedTrees<3){const node=queue.shift()!;try{
  resolver.network.budget.guard();out.coverage.visitedTrees++;const raw=await resolver.provider.get(resolver.objectEndpoint(resolution,'trees',node.sha),resolver.network);if(!raw)throw new Error(resolver.provider.failure());const tree=parseTree(raw,node.sha);
  // A truncated tree cannot be independently rehashed. Do not expose its objects as selectable.
  if(tree.truncated)throw new Error('tree truncated; unverified partial entries withheld');cache.set(`${resolution.requestedId}:${node.sha}`,tree);successfulTrees++;
  const entries=[...tree.entries].sort((a,b)=>Number(!/^(src|lib|source|packages)$/.test(a.path))-Number(!/^(src|lib|source|packages)$/.test(b.path))||a.path.localeCompare(b.path));
  for(const e of entries){const path=node.path?`${node.path}/${e.path}`:e.path;
   const filtered=classify(path+(e.type==='tree'?'/':''),' '.repeat(20));let reason=filtered.classification==='application_source'||e.type==='tree'&&filtered.classification==='unsupported'?'':filtered.reasons.join('; ');
   if(/(^|\/)(dist|build|coverage|out|\.git|\.next|third-party|thirdparty)(\/|$)/i.test(path))reason='generated or third-party directory';
   if(path.length>256)reason='path exceeds supported 256 character limit';
   if(e.type==='tree'){if(reason){out.coverage.filtered.push({path,reason});continue;}if(node.depth>=2){out.coverage.unlistedDirectories.push(path+' (depth limit)');continue;}queue.push({path,sha:e.sha,depth:node.depth+1});continue;}
   if(e.type!=='blob'||!['100644','100755'].includes(e.mode))reason='submodule or symlink not followed';
   else if(e.size===undefined)reason='file size unavailable';else if(e.size>resolver.network.budget.profile.bytesPerFile)reason='file exceeds 128 KiB source ceiling';
   else if(e.size>24000)reason='blob cannot fit conservative 32 KiB base64 response reservation';
   else if(e.size<20)reason='too small for supported source comparison';
   const file:ListedFile={path,type:e.type,bytes:e.size??null,blob:e.sha,selectable:!reason,reason:reason||'supported JS/TS; content filters run after digest-checked read',language:/\.[cm]?js$/.test(path)?'javascript':/\.[cm]?ts$/.test(path)?'typescript':'unsupported'};
   out.files.push(file);if(reason)out.coverage.filtered.push({path,reason});
  }
 }catch(error){out.coverage.reasons.push(`${node.path||'/'}: ${error instanceof Error?error.message:'tree unavailable'}`);out.coverage.unlistedDirectories.push(node.path||'/');}}
 out.coverage.unlistedDirectories.push(...queue.map(n=>n.path+' (directory budget)'));
 out.coverage.enumeration=out.coverage.unlistedDirectories.length?(successfulTrees?'partial':'failed'):'complete';
 out.coverage.state=out.coverage.enumeration==='complete'?'listed':out.coverage.enumeration==='partial'?'partial':'unavailable';out.coverage.eligibleFiles=out.files.filter(f=>f.selectable).length;if(!out.coverage.eligibleFiles)out.coverage.reasons.push('no eligible source in listed directories');
 return out;
}
