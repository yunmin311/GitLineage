/** Hash only this test's temporary cache, including filenames; never credential stores. */
import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
export async function cacheProof(root:string){
 const files:{path:string;sha256:string}[]=[];
 async function visit(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await visit(path);else if(entry.isFile())files.push({path:relative(root,path),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});}}
 await visit(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
