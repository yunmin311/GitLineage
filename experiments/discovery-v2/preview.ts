/** Local authorized experiment. No Graph/cache imports or writes; no credential discovery. */
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {NetworkLedger} from '../../src/discovery/network.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK} from '../../src/discovery/resolution.ts';
import type {Resolution} from '../../src/discovery/resolution.ts';
import {parseObservation} from '../../src/discovery/search-contract.ts';
import {buildQueryPlan,discoverRepositories} from '../../src/discovery/search.ts';
import {sealPreviewExport,searchDiscoveries} from './preview-contract.ts';
import type {PreviewExport} from './preview-contract.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
import {listSources} from './source-selection.ts';
import type {SourceDirectory} from './source-selection.ts';
import type {TreeCache} from '../../src/discovery/source-collection.ts';
import {validateSelections} from '../../src/discovery/source-collection.ts';
import {runPinnedProbe} from '../../src/discovery/pinned-probe.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
import type {SnapshotReceipt} from '../../src/discovery/snapshot-provider.ts';

export const PREVIEW_PROFILE=Object.freeze({...SNAPSHOT_PROFILE,searchAttempts:2});
const selections=[{path:'index.js',reason:'fixed root JavaScript entry'}, {path:'index.ts',reason:'fixed root TypeScript entry'}, {path:'src/index.js',reason:'fixed src JavaScript entry'}, {path:'src/index.ts',reason:'fixed src TypeScript entry'}];
type SearchOutput={target:Resolution|null;result:Awaited<ReturnType<typeof discoverRepositories>>|null;requests:SnapshotReceipt[];usage:ReturnType<BudgetLedger['usage']>;network:ReturnType<NetworkLedger['usage']>;scope:string};
export interface PreviewTask {id:string;kind:'search'|'sources'|'compare';state:'running'|'completed'|'partial'|'cancelled';phase:string;createdAt:string;error:string|null;search?:SearchOutput;comparison?:Awaited<ReturnType<typeof runPinnedProbe>>;export?:PreviewExport;sources?:{searchTaskId:string;requests:SnapshotReceipt[];repositories:SourceDirectory[];usage:ReturnType<BudgetLedger['usage']>;network:ReturnType<NetworkLedger['usage']>}}
export interface FileChoice {sourceTaskId:string;files:{repositoryId:number;paths:string[]}[]}
interface Session {ledger:BudgetLedger;network:NetworkLedger;resolver:RepositorySnapshotResolver;resolutions:Map<number,Resolution>;trees:TreeCache;controller:AbortController;spent:number;started:number|null;task:PreviewTask|null;sourcesStarted:boolean;compareStarted:boolean;sourceTaskId:string|null;stages:{taskId:string;kind:string;wallMs:number;attempts:number;reservedBytes:number}[]}
export interface PreviewOptions {transport?:Transport;cooldownMs?:number}
export function repositoryInput(value:unknown):string {
 if(typeof value!=='string'||value.length>180)throw new Error('invalid repository');
 const name=value.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'').toLowerCase();
 if(!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(name)||['.','..'].includes(name.split('/')[1]!))throw new Error('invalid repository; use public owner/repo');
 return name;
}
export function createPreview(options:PreviewOptions={}) {
 const session=randomBytes(32).toString('hex'),tasks=new Map<string,PreviewTask>(),controllers=new Map<string,AbortController>(),promises=new Map<string,Promise<void>>();
 const sessions=new Map<string,Session>();
 let active:string|null=null,lastStart=0,quotaUntil=0;const starts:number[]=[];
 const transport:Transport=options.transport??((url,init)=>fetch(url,init));
 function get(id:string){const task=tasks.get(id);if(!task||Date.now()-Date.parse(task.createdAt)>1800000)throw new Error('task unavailable or expired');return task;}
 function tracked(task:PreviewTask):Transport{return async(url,init)=>{const path=new URL(url).pathname;task.phase=path==='/search/repositories'?'searching candidates':path.includes('/git/blobs/')?'reading pinned source':path.includes('/git/trees/')?'reading pinned tree':path.includes('/commits/')?'pinning commit':'verifying repository ID';
  const response=await transport(url,init);const retry=response.headers.get('retry-after');const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
  if([403,429].includes(response.status)||response.headers.get('x-ratelimit-remaining')==='0'||retry){const delay=retry?( /^\d+$/.test(retry)?Date.now()+Number(retry)*1000:Date.parse(retry)):0;quotaUntil=Math.max(quotaUntil,reset||0,delay||0,Date.now()+60000);}
  return response;
 };}
 function begin(kind:PreviewTask['kind'],run:(task:PreviewTask,signal:AbortSignal)=>Promise<boolean>,context?:Session) {
  const now=Date.now();if(now<quotaUntil)throw new Error('quota unavailable until '+new Date(quotaUntil).toISOString());if(active)throw new Error('preview busy: one task at a time');
  if(now-lastStart<(options.cooldownMs??15000))throw new Error('preview cooldown: wait before starting another task');
  while(starts[0]!==undefined&&starts[0]<now-60000)starts.shift();if(starts.length>=4)throw new Error('preview frequency limit: four tasks per minute');
  for(const [id,task] of tasks)if(now-Date.parse(task.createdAt)>1800000){tasks.delete(id);promises.delete(id);sessions.delete(id);}
  while(tasks.size>=12){const id=tasks.keys().next().value!;tasks.delete(id);promises.delete(id);sessions.delete(id);}
  const task:PreviewTask={id:randomBytes(12).toString('hex'),kind,state:'running',phase:'starting',createdAt:new Date(now).toISOString(),error:null};
  if(context){context.ledger.guard();context.started=performance.now();context.task=task;}
  const controller=context?.controller??new AbortController(),before=context?.ledger.usage().attempts??0,reserved=context?.network.usage().reservedBytes??0,phaseStarted=performance.now();tasks.set(task.id,task);controllers.set(task.id,controller);active=task.id;lastStart=now;starts.push(now);
  const timer=setTimeout(()=>controller.abort('deadline: 30 seconds'),context?Math.max(1,context.ledger.remainingMs()):30000);
  const promise=(async()=>{
   try{const complete=await run(task,controller.signal);task.state=controller.signal.aborted?'cancelled':complete?'completed':'partial';}
   catch(error){task.error=error instanceof Error?error.message:'preview failed';task.state=controller.signal.aborted?'cancelled':'partial';}
   finally{
    clearTimeout(timer);
    if(controller.signal.aborted&&!task.error)task.error=String(controller.signal.reason);
    try{
     if(context){
      const wallMs=performance.now()-phaseStarted;context.spent+=wallMs;context.started=null;
      context.stages.push({taskId:task.id,kind,wallMs,attempts:context.ledger.usage().attempts-before,reservedBytes:context.network.usage().reservedBytes-reserved});
      if(task.export&&context.sourceTaskId){
       const sources=get(context.sourceTaskId).sources!;
       task.export=sealPreviewExport(task.export.provenance,task.export.probe,{
        schemaVersion:'bounded-tree-selection@1',sourceTaskId:context.sourceTaskId,searchReceipt:(({coverage,attempts,queries,usage,network})=>({coverage,attempts,queries,usage,network}))(get(sources.searchTaskId).search!.result!),repositories:sources.repositories,
        selected:task.comparison!.content.snapshots.map(s=>({repositoryId:s.expectedId!,paths:s.control.selections.map(s=>s.path)})),
        stages:context.stages,combined:{usage:context.ledger.usage(),network:context.network.usage(),activeWallMs:context.spent,elapsedWallMs:Date.now()-Date.parse(get(sources.searchTaskId).createdAt)},
        coverageScope:'selected files only; repository-wide coverage unknown'});
      }
     }
    }catch(error){delete task.export;task.state='partial';task.error='Export validation failed: '+(error instanceof Error?error.message:'invalid receipt');}
    finally{task.phase=task.state;controllers.delete(task.id);active=null;}
   }
  })();promises.set(task.id,promise);return task;
 }
 function startSearch(input:unknown){const name=repositoryInput(input),controller=new AbortController();
  const context={controller,spent:0,started:null,task:null,sourcesStarted:false,compareStarted:false,sourceTaskId:null,resolutions:new Map(),trees:new Map(),stages:[]} as unknown as Session;
  const ledger=new BudgetLedger(PREVIEW_PROFILE,controller.signal,()=>context.spent+(context.started===null?0:performance.now()-context.started)),network=new NetworkLedger(ledger,SNAPSHOT_NETWORK),resolver=new RepositorySnapshotResolver(network,{transport:(url,init)=>tracked(context.task!)(url,init)});Object.assign(context,{ledger,network,resolver});
  const task=begin('search',async(task,signal)=>{
  const raw=await resolver.provider.get(`/repos/${name}`,network),observation=raw?parseObservation(raw,new Date().toISOString(),'repository_metadata'):null;
  const target=observation?await resolver.resolve(observation.repositoryId,[observation]):null;
  if(target?.identity)context.resolutions.set(target.requestedId,target);
  let result:SearchOutput['result']=null;
  if(target?.identity&&!resolver.provider.stopped){task.phase='searching candidates';result=await discoverRepositories(buildQueryPlan(target.identity,{}, {perPage:3,pages:1}),{transport:tracked(task)},network);}
  task.search={target:structuredClone(target),result,requests:structuredClone(resolver.provider.receipts),usage:ledger.usage(),network:network.usage(),scope:'one name query, first three results, at most three candidates; no whole-GitHub coverage'};
  if(!target?.identity)task.error=target?.reasons.join('; ')??'bootstrap: '+resolver.provider.failure();
  else if(result&&result.coverage.state!=='complete_within_requested')task.error=`Search ${result.coverage.state}: ${result.attempts.filter(a=>a.outcome!=='success').map(a=>a.outcome).join('; ')||'unfetched pages or rejected identities; see coverage'}`;
  return !!target?.identity&&result?.coverage.state==='complete_within_requested';
 },context);sessions.set(task.id,context);return task;}
 function selectedCandidates(searchId:string,ids:unknown){
  const parent=get(searchId),search=parent.search;if(parent.kind!=='search'||parent.state==='running'||!search?.target?.identity||!search.result)throw new Error('completed target search required');
  if(!Array.isArray(ids)||ids.length<1||ids.length>2||new Set(ids).size!==ids.length)throw new Error('select one or two distinct discovered IDs');
  const candidates=ids.map(id=>{const c=search.result!.candidates.find(c=>c.candidate.repositoryId===id);if(!c||c.candidate.conflicts.includes('name_id_collision'))throw new Error('only unambiguous discovered IDs can be compared');return c;});
  return {parent,search,candidates,target:search.target.identity};
 }
 function startSources(searchId:string,ids:unknown){const {candidates}=selectedCandidates(searchId,ids),context=sessions.get(searchId)!;if(context.sourcesStarted||context.compareStarted)throw new Error('source selection already started or session closed');
  const task=begin('sources',async(task)=>{const repositories:SourceDirectory[]=[];const target=context.resolutions.values().next().value!;
   const resolutions=[target];for(const c of candidates){const r=await context.resolver.resolve(c.candidate.repositoryId,c.candidate.observations);context.resolutions.set(r.requestedId,r);resolutions.push(r);}
   for(const r of resolutions){const listing=await listSources(r,context.resolver,context.trees);
    if(r.identity){const raw=await context.resolver.provider.get(`/repos/${r.identity.fullName}`,context.network),post=raw?parseObservation(raw,new Date().toISOString(),'repository_metadata'):null;if(!post||post.repositoryId!==r.requestedId||post.fullName!==r.identity.fullName){r.state='inconclusive';r.identity=null;r.tree=null;r.reasons.push('source listing final identity unavailable or changed');listing.files=[];listing.coverage.state='unavailable';listing.coverage.reasons.push(...r.reasons);}}
    repositories.push(listing);
   }task.sources={searchTaskId:searchId,requests:structuredClone(context.resolver.provider.receipts),repositories,usage:context.ledger.usage(),network:context.network.usage()};return repositories.every(r=>r.coverage.state==='listed');
  },context);context.sourcesStarted=true;context.sourceTaskId=task.id;return task;
 }
 function startCompare(searchId:string,ids:unknown,choice?:FileChoice){
  const {parent,search,candidates,target}=selectedCandidates(searchId,ids),context=sessions.get(searchId)!;if(context.compareStarted)throw new Error('comparison already started; session closed');
  let paths=new Map<number,typeof selections>();
  if(choice){if(!choice||Object.keys(choice).sort().join()!=='files,sourceTaskId')throw new Error('invalid source selection');const sources=get(choice.sourceTaskId);if(context.sourceTaskId!==choice.sourceTaskId||sources.state==='running'||sources.sources?.searchTaskId!==searchId||!Array.isArray(choice.files)||choice.files.length!==candidates.length+1)throw new Error('matching completed source task required');
   for(const c of choice.files){if(!c||Object.keys(c).sort().join()!=='paths,repositoryId')throw new Error('invalid source choice');if(!Array.isArray(c.paths)||!c.paths.length||c.paths.length>8||paths.has(c.repositoryId))throw new Error('one to eight distinct source paths per repository required');const listed=sources.sources.repositories.find(r=>r.repositoryId===c.repositoryId);if(!listed||!context.resolutions.get(c.repositoryId)?.identity||c.paths.some(p=>!listed.files.some(f=>f.path===p&&f.selectable)))throw new Error('only verified selectable listed paths allowed');const selected=c.paths.map(path=>({path,reason:'explicit user selection from pinned bounded tree'}));validateSelections(selected);paths.set(c.repositoryId,selected);}
   if(![target.repositoryId!,...candidates.map(c=>c.candidate.repositoryId)].every(id=>paths.has(id)))throw new Error('selection identity mismatch');
  }else if(context.sourcesStarted)throw new Error('visible source selection required');
  const task=begin('compare',async(task,signal)=>{
   task.comparison=await runPinnedProbe([{name:target.fullName,repositoryId:target.repositoryId,revision:target.revision,selections:paths.get(target.repositoryId!)??selections},...candidates.map(c=>({name:c.candidate.fullName,repositoryId:c.candidate.repositoryId,revision:context.resolutions.get(c.candidate.repositoryId)?.identity?.revision,observations:c.candidate.observations,selections:paths.get(c.candidate.repositoryId)??selections}))],{transport:tracked(task),profile:PREVIEW_PROFILE,signal,discoveryById:new Map(candidates.map(c=>[c.candidate.repositoryId,searchDiscoveries(c)])),context});
   task.export=sealPreviewExport({schemaVersion:'discovery-preview-provenance@1',searchTaskId:parent.id,compareTaskId:task.id,searchContentDigest:sha256(stableJSON(search.result)),target:{repositoryId:target.repositoryId!,revision:target.revision},candidates:candidates.map((c,i)=>({repositoryId:c.candidate.repositoryId,revision:task.comparison!.content.snapshots[i+1]?.resolution?.identity?.revision??null,searchCandidate:structuredClone(c)})),status:'search_observation_only'},task.comparison);
   return task.comparison.content.coverage.state==='completed';
  },context);context.compareStarted=true;return task;
 }
 function cancel(id:string){get(id);controllers.get(id)?.abort('user cancelled');}
 function equal(a:string,b:string){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
 async function handler(req:IncomingMessage,res:ServerResponse){
  const send=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  const host=req.headers.host??'',remote=req.socket.remoteAddress;
  if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')||req.headers.forwarded||req.headers['x-forwarded-for']||req.headers['x-forwarded-host']){send(403,{error:'local authorized preview only'});return;}
  const url=new URL(req.url??'/',`http://${host}`);
  if(req.method==='GET'&&url.pathname.startsWith('/preview-access/')){
   if(!equal(url.pathname.slice('/preview-access/'.length),session)){send(403,{error:'invalid preview access'});return;}
   res.writeHead(303,{'set-cookie':`gl_preview=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,'location':'/','cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return;
  }
  const cookie=req.headers.cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith('gl_preview='))?.slice(11)??'';
  if(!equal(cookie,session)){send(403,{error:'preview authorization required'});return;}
  if(req.method==='GET'&&url.pathname==='/api/deep-search/capabilities'){send(200,{enabled:true,scope:'local authorized alpha',budget:PREVIEW_PROFILE,network:SNAPSHOT_NETWORK,cooldownMs:options.cooldownMs??15000,selectedCandidates:2,sourceSelection:{version:'bounded-tree-selection@1',treesPerRepository:3,maxDepth:3,filesPerRepository:8},verification:'pending',lineageClaim:'none'});return;}
  if(req.method==='GET'&&/^\/api\/deep-search\/tasks\/[a-f0-9]{24}$/.test(url.pathname)){try{send(200,get(url.pathname.split('/').at(-1)!));}catch{send(404,{error:'task unavailable or expired'});}return;}
  if(req.method!=='POST'||req.headers.origin!==`http://${host}`||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){send(403,{error:'same-origin JSON required'});return;}
  let data:Record<string,unknown>;try{let bytes=0;const parts:Buffer[]=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2048){send(413,{error:'request too large'});return;}parts.push(chunk);}data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{send(400,{error:'invalid JSON'});return;}
  try{
   if(url.pathname==='/api/deep-search/search'&&Object.keys(data).join() ==='repository'){send(202,startSearch(data.repository));return;}
   if(url.pathname==='/api/deep-search/sources'&&Object.keys(data).sort().join()==='candidateIds,searchId'&&typeof data.searchId==='string'){send(202,startSources(data.searchId,data.candidateIds));return;}
   if(url.pathname==='/api/deep-search/compare'&&['candidateIds,searchId','candidateIds,searchId,selection'].includes(Object.keys(data).sort().join())&&typeof data.searchId==='string'){send(202,startCompare(data.searchId,data.candidateIds,data.selection as FileChoice|undefined));return;}
   if(/^\/api\/deep-search\/tasks\/[a-f0-9]{24}\/cancel$/.test(url.pathname)&&Object.keys(data).length===0){const id=url.pathname.split('/').at(-2)!;cancel(id);send(200,get(id));return;}
   send(400,{error:'invalid preview request'});
  }catch(error){const message=error instanceof Error?error.message:'preview unavailable';send(/quota|busy|cooldown|frequency/.test(message)?429:400,{error:message});}
 }
 return {handler,startSearch,startSources,startCompare,cancel,get,wait:async(id:string)=>{await promises.get(id);return get(id);},accessPath:`/preview-access/${session}`,close:async()=>{for(const id of controllers.keys())cancel(id);await Promise.all(promises.values());}};
}
