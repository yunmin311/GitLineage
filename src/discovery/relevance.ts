/** Metadata-only review ordering. No network, inferred lineage or probability. */
export interface RepositoryMetadata {description:string|null;language:string|null;topics:string[]}
export function metadata(value:unknown,credential?:string):RepositoryMetadata {
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const text=(s:unknown,max:number)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s)&&(!credential||!s.toLowerCase().includes(credential.toLowerCase()))?s:null;
 const ownTopic=typeof v.full_name==='string'?v.full_name.split('/').at(-1)?.toLowerCase():null;
 return {description:text(v.description,512),language:text(v.language,32),topics:Array.isArray(v.topics)?v.topics.slice(0,20).flatMap(t=>{const s=text(t,50);return s&&s.toLowerCase()!==ownTopic&&/^[a-z0-9-]+$/i.test(s)?[s.toLowerCase()]:[];}):[]};
}
const generic=new Set('the and for with this that from into your code project library repository github javascript typescript node nodejs simple fast lightweight modern next generation powered framework tool tools module utility utilities implementation using use supports based an a to of in on is by as it'.split(' '));
const genericTopics=new Set('javascript typescript node nodejs node-js npm npm-package library framework web browser frontend backend react vue angular python java go rust cpp csharp'.split(' '));
function terms(s:string|null){return new Set((s?.toLowerCase().match(/[a-z][a-z0-9]{2,}/g)??[]).map(w=>/^(concurrency|concurrent|concurrently)$/.test(w)?'concurrent':w==='promises'?'promise':w==='limiting'||w==='limited'?'limit':w).filter(w=>!generic.has(w)));}
export function relevance(target:RepositoryMetadata,candidate:RepositoryMetadata){
 const targetTerms=terms(target.description),shared=[...terms(candidate.description)].filter(w=>targetTerms.has(w)).sort(),topics=[...new Set(candidate.topics.filter(t=>!genericTopics.has(t)&&!/^(?:(?:node(?:js|-js)?|npm|javascript|typescript|js|ts)-)?(?:module|package)s?$/.test(t)&&target.topics.includes(t)))].sort();
 const language=(s:string|null)=>s&&/^(javascript|typescript)$/i.test(s)?'js/ts':s?.toLowerCase();
 const compatible=target.language&&candidate.language?language(target.language)===language(candidate.language):null;
 const supported=compatible!==false&&(shared.length>=2||topics.length>0);
 const reasons=[...(shared.length?[`Shared description terms: ${shared.join(', ')}`]:[]),...(topics.length?[`Shared topics: ${topics.join(', ')}`]:[]),compatible===false?'Different primary languages; cross-language usefulness unconfirmed':compatible===true?'Compatible primary language (not sufficient alone)':'Primary-language compatibility unknown'];
 if(!supported)reasons.push('Insufficient purpose evidence; a name match alone is not a recommendation');
 return {level:supported?'supported' as const:'insufficient' as const,reasons,sharedTerms:shared,sharedTopics:topics,order:supported?2+Math.min(shared.length,4)+Math.min(topics.length,2):0};
}
