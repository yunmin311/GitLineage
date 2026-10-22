import {treeFixture} from './tree-fixture.ts';
export const purpose={description:'Promise queue with concurrency control',language:'JavaScript',topics:['concurrency']};
export function relevanceFixture(){const f=treeFixture();f.repos[2]!.files={'index.js':Buffer.from('export function load(options) { console.log(options); return {enabled: true, mode: \"default\", count: 42}; }\n')};f.rebuild();const transport:typeof f.transport=async(url,init)=>{
 const response=await f.transport(url,init),body=await response.json() as any,path=new URL(url).pathname;
 if(path==='/search/repositories')for(const item of body.items)Object.assign(item,item.id===4?purpose:{description:'Limit order decentralized exchange',language:'Solidity',topics:[]});
 if(path==='/repos/root/example')Object.assign(body,purpose);
 return new Response(JSON.stringify(body),{status:response.status});
};return {...f,transport};}
