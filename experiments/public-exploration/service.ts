/** Anonymous, bounded sidecars. No canonical graph/cache imports or writes. */
import {randomBytes} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createPreview,repositoryInput,PREVIEW_PROFILE} from '../discovery-v2/preview.ts';
import type {FileChoice} from '../discovery-v2/preview.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
export type {Transport} from '../../src/discovery/search-provider.ts';
import {createRepositoryExplorer} from './repository-explorer.ts';

export function createPublicExploration(options:{transport?:Transport;cooldownMs?:number;origin?:string}={}) {
 const fixedOrigin=options.origin?new URL(options.origin):null;
 if(fixedOrigin&&(fixedOrigin.origin!==options.origin||!['http:','https:'].includes(fixedOrigin.protocol)||fixedOrigin.username||fixedOrigin.password))throw new Error('Public exploration requires an exact HTTP(S) origin');
 const owners=new Map<string,{visitor:string;address:string;searchId:string;kind:'deep'|'explore';created:number}>();
 const starts=new Map<string,number>();let reservedAttempts=0,windowEnd=Date.now()+3600000,quotaUntil=0;
 const usage=()=>({reservedAttempts,attemptsPerHour:48,resetAt:new Date(windowEnd).toISOString(),scope:'one service process; nonrefundable reservations; restart resets anonymous quota'});
 const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
 const transport:Transport=async(url,init)=>{
  const response=await (options.transport??fetch)(url,init);
  if([403,429].includes(response.status)||response.headers.get('x-ratelimit-remaining')==='0'){
   const reset=Number(response.headers.get('x-ratelimit-reset'))*1000,retry=Number(response.headers.get('retry-after'))*1000;
   quotaUntil=Math.max(quotaUntil,reset||0,Date.now()+(retry||60000));
  }return response;
 };
 // Both engines consume the same process-wide provider cooldown and reservation pool.
 const engine=createPreview({...options,transport}),repoEngine=createRepositoryExplorer({...options,transport});
 function reserve(address:string){
  const now=Date.now();if(now>=windowEnd){reservedAttempts=0;windowEnd=now+3600000;starts.clear();}
  if(now<quotaUntil)throw new Error('GitHub quota unavailable until '+new Date(quotaUntil).toISOString());
  if(now-(starts.get(address)??0)<60000)throw new Error('Anonymous frequency limit: wait one minute before starting another exploration');
  if(reservedAttempts+24>48)throw new Error('Shared anonymous quota exhausted; resets '+new Date(windowEnd).toISOString());
  if(repoEngine.busy()||engineBusy())throw new Error('Shared service busy; wait for current task');
 }
 function engineBusy(){return [...owners].some(([id,o])=>o.kind==='deep'&&(()=>{try{return engine.get(id).state==='running';}catch{return false;}})());}
 function debit(address:string){reservedAttempts+=24;starts.set(address,Date.now());}
 async function handler(req:IncomingMessage,res:ServerResponse){
  const host=req.headers.host??'';if((fixedOrigin?host!==fixedOrigin.host:!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host))||Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-'))){send(res,403,{error:'Invalid host or unsupported forwarded headers'});return;}
  const origin=fixedOrigin?.origin??`http://${host}`,url=new URL(req.url??'/',origin),address=req.socket.remoteAddress??'unknown';
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>/^gl_visitor=[a-f0-9]{48}$/.test(s))?.slice(11);
  const visitor=cookie??randomBytes(24).toString('hex');
  const owned=(id:string)=>{const o=owners.get(id);if(!o||o.visitor!==visitor||o.address!==address||Date.now()-o.created>1800000)throw new Error('Result unavailable or expired');return o;};
  const remember=(id:string,kind:'deep'|'explore',searchId=id)=>{owners.set(id,{visitor,address,kind,searchId,created:Date.now()});res.setHeader('set-cookie',`gl_visitor=${visitor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${fixedOrigin?.protocol==='https:'?'; Secure':''}`);};
  for(const [id,o] of owners)if(Date.now()-o.created>1800000)owners.delete(id);
  if(req.method==='GET'&&url.pathname==='/api/deep-search/capabilities'){send(res,200,{enabled:true,scope:'anonymous',budget:PREVIEW_PROFILE,cooldownMs:options.cooldownMs??15000,quota:usage(),verification:'pending',lineageClaim:'none'});return;}
  if(req.method==='GET'&&/^\/api\/(?:deep-search\/tasks|explore)\/[a-f0-9]{24}$/.test(url.pathname)){
   try{const id=url.pathname.split('/').at(-1)!,o=owned(id);send(res,200,o.kind==='deep'?engine.get(id):repoEngine.get(id));}catch{send(res,404,{error:'Result unavailable or expired'});}return;
  }
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-gitlineage-csrf']!=='1'||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){send(res,403,{error:'Same-origin JSON with CSRF header required'});return;}
  let body:Record<string,unknown>;
  try {
   const chunks:Buffer[]=[];let bytes=0;const timeout=setTimeout(()=>req.destroy(),5000);
   try{for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error('Body exceeds 4 KiB');chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid JSON');}finally{clearTimeout(timeout);}
  }catch{if(!res.destroyed)send(res,400,{error:'Invalid or oversized JSON body'});return;}
  try{
   if(['/api/deep-search/search','/api/explore'].includes(url.pathname)&&Object.keys(body).join()==='repository'){
    const repository=repositoryInput(body.repository);reserve(address);
    const kind=url.pathname==='/api/explore'?'explore':'deep';
    const task=kind==='deep'?engine.startSearch(repository):repoEngine.start(repository);debit(address);remember(task.id,kind);send(res,202,task);return;
   }
   if(['/api/deep-search/sources','/api/deep-search/compare'].includes(url.pathname)&&typeof body.searchId==='string'){
    if(repoEngine.busy())throw new Error('Shared service busy');const owner=owned(body.searchId);if(owner.kind!=='deep')throw new Error('Search task required');
    if(body.selection){const choice=body.selection as FileChoice;const source=owned(choice.sourceTaskId);if(source.searchId!==body.searchId)throw new Error('Source task mismatch');}
    const task=url.pathname.endsWith('/sources')?engine.startSources(body.searchId,body.candidateIds):engine.startCompare(body.searchId,body.candidateIds,body.selection as FileChoice|undefined);
    remember(task.id,'deep',body.searchId);send(res,202,task);return;
   }
   const match=url.pathname.match(/^\/api\/(deep-search\/tasks|explore)\/([a-f0-9]{24})\/(cancel|directory|revision)$/);
   if(match){const id=match[2]!,owner=owned(id);if(match[3]==='cancel'){owner.kind==='deep'?engine.cancel(id):repoEngine.cancel(id);send(res,200,{cancelled:true});return;}
    if(engineBusy())throw new Error('Shared service busy');if(owner.kind!=='explore')throw new Error('Repository exploration required');
    const task=match[3]==='directory'?await repoEngine.directory(id,body.path):await repoEngine.revision(id,body.sha);send(res,200,task);return;}
   send(res,400,{error:'Invalid exploration request'});
  }catch(error){const message=error instanceof Error?error.message:'Exploration unavailable';send(res,/quota|frequency|busy|cooldown|exhausted/.test(message)?429:400,{error:message,quota:usage()});}
 }
 return {handler,usage,wait:async(id:string)=>{const o=owners.get(id);return o?.kind==='deep'?engine.wait(id):repoEngine.wait(id);},close:async()=>{await Promise.all([engine.close(),repoEngine.close()]);}};
}
