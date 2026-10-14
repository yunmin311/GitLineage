import {createHash} from 'node:crypto';
import {gitBlob} from '../../src/discovery/snapshot.ts';
import {gitTree} from '../../src/discovery/source-collection.ts';
import type {TreeEntry} from '../../src/discovery/source-collection.ts';
import {buildQueryPlan} from '../../src/discovery/query.ts';
import type {SnapshotIdentity} from '../../src/discovery/contract.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
export const FIXED_TIME='2026-10-09T00:00:00.000Z';
export const SOURCE='export function sum(values) { return values.reduce((total, value) => total + value, 0); }\n';
export interface MockRepo {id:number;name:string;searchName?:string;revision:string;files:Record<string,Buffer>;label:'positive'|'negative'|'unknown'}
export function mockFixture(){
 const repos:MockRepo[]=[{id:1,name:'root/example',revision:'1'.repeat(40),files:{'index.js':Buffer.from(SOURCE)},label:'positive'},
 {id:2,name:'fork/example',searchName:'old/example',revision:'2'.repeat(40),files:{'index.js':Buffer.from(SOURCE)},label:'positive'},
 {id:3,name:'other/example',revision:'3'.repeat(40),files:{'index.js':Buffer.from('export const answer = 12345;\n')},label:'negative'},
 {id:4,name:'unknown/example',revision:'4'.repeat(40),files:{'index.js':Buffer.from(SOURCE)},label:'unknown'}];
 const calls:string[]=[],routes=new Map<string,unknown>();
 function rebuild(){routes.clear();for(const repo of repos){const entries:TreeEntry[]=Object.entries(repo.files).map(([path,bytes])=>({path,mode:'100644',type:'blob',sha:gitBlob(bytes),size:bytes.length}));const tree=gitTree(entries);
  const parent=repo.id===2?repos[0]!.revision:null;const commitBody=`tree ${tree}\n${parent?`parent ${parent}\n`:''}author Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\n${repo.id===2?'known constructed fork':repo.label+' '+repo.id}\n`;repo.revision=createHash('sha1').update(`commit ${Buffer.byteLength(commitBody)}\0`).update(commitBody).digest('hex');
  routes.set(`/repositories/${repo.id}`,{id:repo.id,full_name:repo.name,html_url:`https://github.com/${repo.name}`,default_branch:'main',fork:repo.id===2,parent:repo.id===2?{id:1}:undefined});
  const commit={sha:repo.revision,commit:{tree:{sha:tree}},parents:parent?[{sha:parent}]:[]};routes.set(`/repositories/${repo.id}/commits/main`,commit);routes.set(`/repositories/${repo.id}/commits/${repo.revision}`,commit);
  routes.set(`/repositories/${repo.id}/git/trees/${tree}`,{sha:tree,truncated:false,tree:entries});
  for(const [path,bytes]of Object.entries(repo.files))routes.set(`/repositories/${repo.id}/git/blobs/${gitBlob(bytes)}`,{sha:gitBlob(bytes),size:bytes.length,encoding:'base64',content:bytes.toString('base64')});
 }}rebuild();
 const target:SnapshotIdentity={provider:'github',repositoryId:1,completeness:'provider_id',fullName:'root/example',aliases:[],revision:repos[0]!.revision};const plan=buildQueryPlan(target,{});
 const transport:Transport=async url=>{const path=new URL(url).pathname;calls.push(path);if(path==='/search/repositories')return new Response(JSON.stringify({total_count:repos.length-1,incomplete_results:false,items:repos.slice(1).map(r=>({id:r.id,full_name:r.searchName??r.name,html_url:`https://github.com/${r.searchName??r.name}`}))}));const value=routes.get(path);return value?new Response(JSON.stringify(value)):new Response('',{status:404});};
 return {repos,routes,calls,transport,plan,rebuild};
}
