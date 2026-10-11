/** Read-only repository structure and bounded commit DAG, separate from canonical lineage. */
import {randomBytes} from 'node:crypto';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {NetworkLedger} from '../../src/discovery/network.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK,record,fullSHA} from '../../src/discovery/resolution.ts';
import type {Resolution} from '../../src/discovery/resolution.ts';
import {parseObservation} from '../../src/discovery/search-contract.ts';
import {parseTree} from '../../src/discovery/source-collection.ts';
import type {TreeEntry} from '../../src/discovery/source-collection.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
import {repositoryInput} from '../discovery-v2/preview.ts';
export interface ExplorerCommit {sha:string;tree:string;parents:string[];message:string;author:string;date:string;changes:{path:string;status:string;additions:number;deletions:number}[]}
export interface ExplorerTask {schemaVersion:'repository-exploration@1';historyAnchor:string|null;id:string;repository:string;state:'running'|'completed'|'partial'|'cancelled';error:string|null;resolution:Resolution|null;revision:string|null;directories:{path:string;sha:string;entries:(TreeEntry&{category:string})[]}[];commits:ExplorerCommit[];branches:{name:string;sha:string}[];coverage:{history:string;branches:string;structure:string;pendingParents:string[]};receipt:unknown;verification:'pending';lineageClaim:'none'}
interface Context {task:ExplorerTask;controller:AbortController;ledger:BudgetLedger;network:NetworkLedger;resolver:RepositorySnapshotResolver;spent:number;started:number|null;promise:Promise<void>;treeReads:number}
export function category(path:string,type:string){if(type==='commit')return 'submodule (pinned gitlink; not followed)';if(type==='tree')return /^(src|lib|packages|modules)$/.test(path.split('/').at(-1)!)?'source modules':/test/i.test(path)?'tests':/doc/i.test(path)?'documentation':'directory';if(/(^|\/)(vendor|node_modules|dist|build)(\/|$)/.test(path))return 'vendor / generated';if(/(^|\/)(test|tests)(\/|$)|\.(test|spec)\./.test(path))return 'tests';if(/\.(md|txt)$|LICENSE/i.test(path))return 'documentation';if(/\.(js|ts|tsx|jsx|py|rs|go|c|h|cpp|java)$/.test(path))return 'source';return 'configuration / other';}
export function createRepositoryExplorer(options:{transport?:Transport}={}){
 const contexts=new Map<string,Context>();let active=false;
 function getContext(id:string){const c=contexts.get(id);if(!c)throw new Error('Exploration unavailable');return c;}
 function receipt(c:Context){c.task.receipt={usage:c.ledger.usage(),network:c.network.usage(),requests:structuredClone(c.resolver.provider.receipts),activeWallMs:c.spent,scope:'explicit visited directories and at most six commits; no repository-wide or complete history claim',cpuHardBudget:'unsupported'};}
 async function run(c:Context,work:()=>Promise<void>){if(active)throw new Error('Exploration busy');c.ledger.guard();active=true;c.task.state='running';c.started=performance.now();const timer=setTimeout(()=>c.controller.abort('deadline'),Math.max(1,c.ledger.remainingMs()));
  try{await work();c.task.state=c.task.coverage.pendingParents.length||c.task.coverage.history!=='complete'?'partial':'completed';}
  catch(error){c.task.error=error instanceof Error?error.message:'Unavailable';c.task.state=c.controller.signal.aborted?'cancelled':'partial';}
  finally{clearTimeout(timer);c.spent+=performance.now()-c.started!;c.started=null;receipt(c);active=false;}
 }
 async function finalIdentity(c:Context){const r=c.task.resolution;if(!r?.identity)throw new Error('Pinned identity unavailable');const raw=await c.resolver.provider.get(`/repos/${r.identity.fullName}`,c.network);const observation=raw?parseObservation(raw,new Date().toISOString(),'repository_metadata'):null;
  if(!observation||observation.repositoryId!==r.requestedId||observation.fullName!==r.identity.fullName){c.task.directories=[];c.task.commits=[];c.task.branches=[];c.task.revision=null;c.task.historyAnchor=null;c.task.resolution=null;throw new Error('Final repository identity changed or unavailable; snapshot withheld');}
 }
 async function tree(c:Context,path:string,sha:string){if(c.treeReads>=6)throw new Error('Directory budget exhausted: six tree reads per exploration');c.treeReads++;const raw=await c.resolver.provider.get(c.resolver.objectEndpoint(c.task.resolution!,'trees',sha),c.network);if(!raw)throw new Error(c.resolver.provider.failure());const parsed=parseTree(raw,sha);if(parsed.truncated)throw new Error('Truncated tree: digest cannot be verified; entries withheld');
  c.task.directories.push({path,sha,entries:parsed.entries.map(e=>({...e,category:category(path?`${path}/${e.path}`:e.path,e.type)}))});c.task.coverage.structure='Only listed directories verified; unopened directories remain unexamined';
 }
 async function commit(c:Context,sha:string){const r=c.task.resolution!;const raw=await c.resolver.provider.get(`/repos/${r.identity!.fullName}/commits/${sha}`,c.network);if(!raw)throw new Error(c.resolver.provider.failure());const v=record(raw),d=record(v.commit),t=record(d.tree);if(v.sha!==sha||!fullSHA(t.sha)||!Array.isArray(v.parents)||v.parents.some(p=>!fullSHA(record(p).sha)))throw new Error('Commit object identity mismatch');const author=d.author&&typeof d.author==='object'?record(d.author):{};
  const changes=Array.isArray(v.files)?v.files.slice(0,40).map(f=>{const file=record(f);return {path:String(file.filename).slice(0,256),status:String(file.status),additions:Number(file.additions)||0,deletions:Number(file.deletions)||0};}):[];
  const item:ExplorerCommit={sha,tree:t.sha,parents:v.parents.map(p=>String(record(p).sha)),message:String(d.message).slice(0,1000),author:String(author.name??'Unknown author').slice(0,100),date:String(author.date??'Unknown date').slice(0,40),changes};c.task.commits.push(item);return item;
 }
 function start(input:unknown){if(active)throw new Error('Exploration busy');for(const [id,c] of contexts)if(c.task.state!=='running'&&contexts.size>=8)contexts.delete(id);
  const repository=repositoryInput(input),controller=new AbortController();const task:ExplorerTask={schemaVersion:'repository-exploration@1',historyAnchor:null,id:randomBytes(12).toString('hex'),repository,state:'running',error:null,resolution:null,revision:null,directories:[],commits:[],branches:[],coverage:{history:'unavailable',branches:'unavailable',structure:'unavailable',pendingParents:[]},receipt:null,verification:'pending',lineageClaim:'none'};
  const c={task,controller,spent:0,started:null,treeReads:0} as unknown as Context;c.ledger=new BudgetLedger(SNAPSHOT_PROFILE,controller.signal,()=>c.spent+(c.started===null?0:performance.now()-c.started));c.network=new NetworkLedger(c.ledger,SNAPSHOT_NETWORK);c.resolver=new RepositorySnapshotResolver(c.network,options);contexts.set(task.id,c);
  c.promise=run(c,async()=>{
   const raw=await c.resolver.provider.get(`/repos/${repository}`,c.network),o=raw?parseObservation(raw,new Date().toISOString(),'repository_metadata'):null;if(!o)throw new Error('Repository metadata unavailable: '+c.resolver.provider.failure());task.resolution=await c.resolver.resolve(o.repositoryId,[o]);const r=task.resolution;if(!r.identity||!r.tree)throw new Error(r.reasons.join('; '));task.revision=r.identity.revision;task.historyAnchor=r.identity.revision;
   await tree(c,'',r.tree);
   task.branches=[{name:r.defaultBranch!,sha:r.identity.revision}];task.coverage.branches='Default branch observed at resolution; other branches not yet listed';
   const branches=await c.resolver.provider.get(`/repos/${r.identity.fullName}/branches?per_page=3&page=1`,c.network);
   if(Array.isArray(branches)&&branches.length<=3&&branches.every(b=>typeof record(b).name==='string'&&fullSHA(record(record(b).commit).sha))){task.branches=branches.map(b=>({name:String(record(b).name).slice(0,255),sha:String(record(record(b).commit).sha)}));task.coverage.branches='First page, at most three branch tips; observed mutable refs, not exhaustive';}
   const queue=[r.identity.revision],seen=new Set<string>();
   while(queue.length&&task.commits.length<6){const sha=queue.shift()!;if(seen.has(sha))continue;seen.add(sha);try{const item=await commit(c,sha);queue.push(...item.parents);}catch(error){task.error=error instanceof Error?error.message:'Commit unavailable';task.coverage.pendingParents.push(sha);break;}}
   task.coverage.pendingParents.push(...queue.filter(sha=>!seen.has(sha)));task.coverage.history=task.coverage.pendingParents.length?'partial: parent objects outside the sampled window':'complete';await finalIdentity(c);
  });return task;
 }
 async function directory(id:string,path:unknown){const c=getContext(id);if(c.task.state==='running')throw new Error('Exploration busy');if(typeof path!=='string'||path.length>256||path.split('/').some(p=>!p||p==='.'||p==='..')||path.split('/').length>8)throw new Error('Invalid directory path');const existing=c.task.directories.find(d=>d.path===path);if(existing)return c.task;
  const parent=path.split('/').slice(0,-1).join('/'),name=path.split('/').at(-1),entry=c.task.directories.find(d=>d.path===parent)?.entries.find(e=>e.path===name&&e.type==='tree');if(!entry)throw new Error('Only a listed directory can be opened; submodules and links are not followed');c.promise=run(c,async()=>{await tree(c,path,entry.sha);await finalIdentity(c);});await c.promise;return c.task;
 }
 async function revision(id:string,sha:unknown){const c=getContext(id);if(c.task.state==='running')throw new Error('Exploration busy');if(!fullSHA(sha)||!c.task.commits.some(x=>x.sha===sha)&&!c.task.branches.some(x=>x.sha===sha))throw new Error('Only observed commit or branch SHA allowed');
  if(sha===c.task.revision)return c.task;c.promise=run(c,async()=>{const old=c.task.resolution!;const next=await c.resolver.resolve(old.requestedId,old.observations,sha);if(!next.identity||!next.tree)throw new Error(next.reasons.join('; '));c.task.resolution=next;c.task.revision=sha;c.task.directories=[];await tree(c,'',next.tree);await finalIdentity(c);});await c.promise;return c.task;
 }
 return {start,get:(id:string)=>getContext(id).task,directory,revision,busy:()=>active,cancel:(id:string)=>getContext(id).controller.abort('user cancelled'),wait:async(id:string)=>{const c=getContext(id);await c.promise;return c.task;},close:async()=>{for(const c of contexts.values())c.controller.abort('shutdown');await Promise.all([...contexts.values()].map(c=>c.promise));}};
}
