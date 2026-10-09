import { BudgetError } from './budget.ts';
import { NetworkLedger } from './network.ts';
import { assertSearchQuery } from './query.ts';
export type Transport=(url:string,init:{method:'GET';headers:Record<string,string>;redirect:'manual';signal:AbortSignal})=>Promise<Response>;
export type AttemptOutcome='success'|'http_error'|'rate_limit'|'unauthorized'|'redirect_rejected'|'invalid_json'|'invalid_response'|'network_error'|'response_bytes_exhausted'|'cancelled'|'timeout'|'budget_denied';
export interface AttemptReceipt {query:number;page:number;retry:number;status:number|null;outcome:AttemptOutcome;headers:Record<string,string>;receivedBytes:number;retainedBytes:number;reservedBytes:number}
export interface SearchPage {total_count:number;incomplete_results:boolean;items:unknown[]}
export interface PageResult {data:SearchPage|null;receipt:AttemptReceipt;stop:boolean;retryAfterMs:number|null}
export interface ProviderOptions {transport?:Transport;token?:string;timeoutMs?:number}
const numericHeaders=['x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','x-ratelimit-used'];
function receiptHeaders(headers:Headers,token?:string):Record<string,string>{
 const out:Record<string,string>={};for(const k of numericHeaders){const value=headers.get(k);if(value&&/^\d{1,16}$/.test(value)&&(!token||!value.includes(token)))out[k]=value;}
 for(const k of ['x-ratelimit-resource','retry-after','x-github-api-version-selected']){const value=headers.get(k);if(value&&value.length<=64&&(!token||!value.includes(token))&& (k==='x-ratelimit-resource'? /^(search|core)$/.test(value):k==='retry-after'? /^\d{1,8}$/.test(value)||/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value): /^\d{4}-\d{2}-\d{2}$/.test(value)))out[k]=value;}
 return out;
}
function delayHeader(value:string|undefined):number|null {if(!value)return null;if(/^\d+$/.test(value))return Number(value)*1000;return Math.max(0,Date.parse(value)-Date.now());}
/** One method, one controlled endpoint, no cache, no credential discovery, no redirects.
 * Injected transports must honor AbortSignal. Race guarding also prevents a broken
 * mock from holding the run open; a late Response is cancelled, never processed.
 */
export class RepositorySearchProvider {
 private transport:Transport;private token:string|undefined;private timeoutMs:number;
 constructor(options:ProviderOptions={}){
  if(options.token!==undefined&&(typeof options.token!=='string'||! /^[a-zA-Z0-9_.-]{1,256}$/.test(options.token)))throw new TypeError('invalid explicit credential');
  const timeout=options.timeoutMs??10000;if(!Number.isSafeInteger(timeout)||timeout<1||timeout>20000)throw new TypeError('invalid request timeout');
  this.token=options.token;this.timeoutMs=timeout;this.transport=options.transport??((url,init)=>fetch(url,init));
 }
 async page(q:string,perPage:number,page:number,queryIndex:number,retry:number,network:NetworkLedger):Promise<PageResult>{
  // Validate independently even when called outside the sidecar runner.
  assertSearchQuery(q);
  if(typeof q!=='string'||q.length>200||!q.length||/[\x00-\x1f]/.test(q)||!Number.isSafeInteger(perPage)||perPage<1||perPage>25||!Number.isSafeInteger(page)||page<1||page>2||!Number.isSafeInteger(retry)||retry<0||retry>1)throw new TypeError('invalid bounded search request');
  const receipt:AttemptReceipt={query:queryIndex,page,retry,status:null,outcome:'budget_denied',headers:{},receivedBytes:0,retainedBytes:0,reservedBytes:0};
  let release:()=>void;try{release=network.reserve();receipt.reservedBytes=network.profile.perResponseBytes;}catch(error){return{data:null,receipt:{...receipt,outcome:network.budget.signal?.aborted?'cancelled':error instanceof BudgetError&&error.message.includes('deadline')?'timeout':'budget_denied'},stop:true,retryAfterMs:null};}
  const controller=new AbortController();let timedOut=false,finished=false;let body:Response['body']=null;let reader:{read:()=>Promise<{done:boolean;value?:Uint8Array}>;cancel:(reason?:unknown)=>Promise<void>}|undefined;
  let rejectStop:(error:Error)=>void=()=>{};
  const interrupted=new Promise<never>((_,reject)=>{rejectStop=reject;});
  void interrupted.catch(()=>{}); // Synchronous abort may precede the first guarded await.
  const stop=()=>{controller.abort();rejectStop(new Error('interrupted'));if(reader)void reader.cancel().catch(()=>{});else if(body)void body.cancel().catch(()=>{});};
  const external=()=>stop();network.budget.signal?.addEventListener('abort',external,{once:true});
  const timer=setTimeout(()=>{timedOut=true;stop();},Math.max(1,Math.min(this.timeoutMs,Math.max(1,network.budget.deadline-performance.now()))));
  const guarded=async<T>(promise:Promise<T>):Promise<T>=>{network.budget.guard();if(controller.signal.aborted)throw new Error('interrupted');const result=await Promise.race([promise,interrupted]);network.budget.guard();if(controller.signal.aborted)throw new Error('interrupted');return result;};
  try{
   const url=new URL('https://api.github.com/search/repositories');url.searchParams.set('q',q);url.searchParams.set('per_page',String(perPage));url.searchParams.set('page',String(page));
   const headers:Record<string,string>={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'GitLineage-Discovery-Experiment'};if(this.token)headers.Authorization=`Bearer ${this.token}`;
   network.budget.guard();const request=this.transport(url.href,{method:'GET',headers,redirect:'manual',signal:controller.signal});
   void request.then(response=>{if(finished||controller.signal.aborted)void response.body?.cancel().catch(()=>{});},()=>{});
   const response=await guarded(request);body=response.body;receipt.status=response.status;receipt.headers=receiptHeaders(response.headers,this.token);
   const retryAfterMs=delayHeader(receipt.headers['retry-after']);
   if(response.status!==200){receipt.outcome=response.status===401?'unauthorized':[403,429].includes(response.status)?'rate_limit':response.status>=300&&response.status<400?'redirect_rejected':'http_error';if(body)await guarded(body.cancel());return{data:null,receipt,stop:['unauthorized','rate_limit','redirect_rejected'].includes(receipt.outcome),retryAfterMs};}
   if(response.redirected||response.url&&new URL(response.url).origin!=='https://api.github.com'){receipt.outcome='redirect_rejected';if(body)await guarded(body.cancel());return{data:null,receipt,stop:true,retryAfterMs:null};}
   // Content-Length is diagnostic only; actual delivered bytes govern retention.
   if(!body){receipt.outcome='invalid_response';return{data:null,receipt,stop:false,retryAfterMs:null};}
   reader=body.getReader();const chunks:Uint8Array[]=[];let size=0;
   while(true){const chunk=await guarded(reader.read());if(chunk.done)break;if(!chunk.value)throw new Error('invalid stream chunk');const bytes=chunk.value.byteLength;receipt.receivedBytes+=bytes;
    if(size+bytes>network.profile.perResponseBytes){network.received(bytes,0);receipt.outcome='response_bytes_exhausted';controller.abort();void reader.cancel().catch(()=>{});return{data:null,receipt,stop:false,retryAfterMs:null};}
    size+=bytes;receipt.retainedBytes+=bytes;network.received(bytes,bytes);chunks.push(chunk.value);
   }
   let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{receipt.outcome='invalid_json';return{data:null,receipt,stop:false,retryAfterMs:null};}
   const data=raw as Partial<SearchPage>|null;
   if(!data||typeof data!=='object'||!Number.isSafeInteger(data.total_count)||data.total_count!<0||typeof data.incomplete_results!=='boolean'||!Array.isArray(data.items)||data.items.length>perPage||data.total_count!<data.items.length){receipt.outcome='invalid_response';return{data:null,receipt,stop:false,retryAfterMs:null};}
   receipt.outcome='success';return{data:data as SearchPage,receipt,stop:receipt.headers['x-ratelimit-remaining']==='0',retryAfterMs:null};
  }catch(error){receipt.outcome=network.budget.signal?.aborted?'cancelled':timedOut||error instanceof BudgetError&&error.message.includes('deadline')||performance.now()>=network.budget.deadline?'timeout':'network_error';return{data:null,receipt,stop:receipt.outcome==='cancelled',retryAfterMs:null};}
  finally{finished=true;clearTimeout(timer);network.budget.signal?.removeEventListener('abort',external);controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(body)void body.cancel().catch(()=>{});release();}
 }
}
