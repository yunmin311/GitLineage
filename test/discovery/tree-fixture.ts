import {createHash} from 'node:crypto';
import {officialFixture} from '../../experiments/discovery-v2/phase1d-mock.ts';
import {gitTree} from '../../src/discovery/source-collection.ts';
import type {TreeEntry} from '../../src/discovery/source-collection.ts';
import {gitBlob} from '../../src/discovery/snapshot.ts';
/** Test-only Git object fixture: real nested tree and blob hashes, fixed official routes. */
export function treeFixture(){const f=officialFixture();const original=f.rebuild;
 function rebuild(){original();for(const repo of f.repos){
  function directory(prefix:string):string {const entries:TreeEntry[]=[];const files=Object.entries(repo.files).filter(([p])=>p.startsWith(prefix));const names=[...new Set(files.map(([p])=>p.slice(prefix.length).split('/')[0]!))];
   for(const name of names){const bytes=repo.files[prefix+name];entries.push(bytes?{path:name,mode:'100644',type:'blob',sha:gitBlob(bytes),size:bytes.length}:{path:name,mode:'040000',type:'tree',sha:directory(prefix+name+'/')});}
   const sha=gitTree(entries);f.routes.set(`/repos/${repo.name}/git/trees/${sha}`,{sha,truncated:false,tree:entries});return sha;
  }
  const tree=directory(''),parent=repo.id===2?f.repos[0]!.revision:null,body=`tree ${tree}\n${parent?`parent ${parent}\n`:''}author Fixture <fixture@example.invalid> 0 +0000\ncommitter Fixture <fixture@example.invalid> 0 +0000\n\nnested ${repo.id}\n`;
  repo.revision=createHash('sha1').update(`commit ${Buffer.byteLength(body)}\0`).update(body).digest('hex');const commit={sha:repo.revision,commit:{tree:{sha:tree}},parents:parent?[{sha:parent}]:[]};f.routes.set(`/repos/${repo.name}/commits/main`,commit);f.routes.set(`/repos/${repo.name}/commits/${repo.revision}`,commit);
 }}rebuild();return {...f,rebuild};}
