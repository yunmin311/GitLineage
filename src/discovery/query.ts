import { validateIdentity } from './contract.ts';
import type { SnapshotIdentity } from './contract.ts';
export interface Query {q:string;source:'repository_name'|'description'|'topic'|'explicit_keyword';reason:string}
export interface QueryPlan {version:'repository-query-plan@1';target:SnapshotIdentity;queries:Query[];perPage:number;pages:number}
export interface QueryInput {description?:string;language?:string;topics?:string[];keywords?:{text:string;source:string}[]}
const secret=/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|(?:token|password|secret|api[_ -]?key)\s*[:=]|-----BEGIN|[A-Za-z0-9_+/=-]{40,})/i;
function safe(value:string,max:number):string {if(typeof value!=='string'||value.length>max||secret.test(value)||/[\x00-\x1f\x7f]/.test(value))throw new TypeError('unsafe query input');return value;}
function word(value:string):string {safe(value,64);if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,63}$/.test(value)||/^(AND|OR|NOT)$/i.test(value))throw new TypeError('invalid query word');return value.toLowerCase();}
export function buildQueryPlan(target:SnapshotIdentity,input:QueryInput={},options:{perPage?:number;pages?:number}={}):QueryPlan {
 validateIdentity(target);if(target.provider!=='github')throw new TypeError('GitHub target required');
 safe(target.fullName,150);const perPage=options.perPage??5,pages=options.pages??1;
 if(!Number.isSafeInteger(perPage)||perPage<1||perPage>25||!Number.isSafeInteger(pages)||pages<1||pages>2)throw new TypeError('invalid bounded pagination');
 const queries:Query[]=[],seen=new Set<string>();let language='';
 if(input.language){safe(input.language,32);if(!/^[a-zA-Z][a-zA-Z0-9+#.-]{0,31}$/.test(input.language))throw new TypeError('invalid language');language=` language:${input.language.toLowerCase()}`;}
 const add=(text:string,source:Query['source'],reason:string,qualifier='in:name,description')=>{const q=[text,qualifier.trim(),language.trim(),'is:public','fork:true'].filter(Boolean).join(' ');if(q.length>200)throw new TypeError('query too long');if(!seen.has(q)&&queries.length<4){seen.add(q);queries.push({q,source,reason});}};
 add(word(target.fullName.split('/')[1]!),'repository_name','fixed target repository name','in:name');
 if(input.description){safe(input.description,512);const stop=new Set(['the','and','for','with','this','that','from','into','your','code','project','library','repository','github']);
  const words=[...new Set((input.description.match(/[a-zA-Z][a-zA-Z0-9.-]{3,31}/g)??[]).map(x=>x.toLowerCase()).filter(x=>!stop.has(x)))].slice(0,3);if(words.length)add(words.map(word).join(' '),'description','first three distinct description terms');}
 if((input.topics?.length??0)>8||(input.keywords?.length??0)>8)throw new TypeError('too many query inputs');
 for(const topic of input.topics??[])add(`topic:${word(topic)}`,'topic','explicit target topic','');
 for(const keyword of input.keywords??[]){const text=word(keyword.text),source=word(keyword.source);add(text,'explicit_keyword',`caller supplied keyword from ${source}`);}
 return{version:'repository-query-plan@1',target:structuredClone(target),queries,perPage,pages};
}
/** Plans are caller data too: reject mutated plans, free-form qualifiers and unknown fields. */
export function assertSearchQuery(q:string):void {
 safe(q,200);if(!/^(?:[a-z0-9][a-z0-9.-]{1,63}(?: [a-z0-9][a-z0-9.-]{1,63}){0,2} in:(?:name|name,description)|topic:[a-z0-9][a-z0-9.-]{1,63})(?: language:[a-z][a-z0-9+#.-]{0,31})? is:public fork:true$/.test(q))throw new TypeError('invalid planned query');
}
export function validatePlan(plan:QueryPlan):void {
 validateIdentity(plan.target);if(plan.version!=='repository-query-plan@1'||plan.target.provider!=='github'||Object.keys(plan).sort().join(',')!=='pages,perPage,queries,target,version'||!Array.isArray(plan.queries)||!plan.queries.length||plan.queries.length>4||!Number.isSafeInteger(plan.perPage)||plan.perPage<1||plan.perPage>25||!Number.isSafeInteger(plan.pages)||plan.pages<1||plan.pages>2)throw new TypeError('invalid query plan');
 const seen=new Set<string>();for(const query of plan.queries){safe(query.q,200);safe(query.reason,150);
  if(Object.keys(query).sort().join(',')!=='q,reason,source'||!['repository_name','description','topic','explicit_keyword'].includes(query.source)||!query.reason||seen.has(query.q))throw new TypeError('invalid planned query');assertSearchQuery(query.q);seen.add(query.q);}
}
