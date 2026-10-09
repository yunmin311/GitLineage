import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
// Dependency graph is a capability boundary, not an exact-source-text assertion.
test('all Discovery module imports stay inside Discovery or approved read/worker/parser builtins',async()=>{
 const directory=resolve('src/discovery');const approved=new Set(['node:fs/promises','node:fs','node:crypto','node:path','node:url','node:worker_threads','typescript']);
 for(const file of await readdir(directory))if(file.endsWith('.ts')){
  const tree=ts.createSourceFile(file,await readFile(join(directory,file),'utf8'),ts.ScriptTarget.Latest,true);
  function visit(n:ts.Node){if(ts.isImportDeclaration(n)){const name=(n.moduleSpecifier as ts.StringLiteral).text;
   if(name.startsWith('.'))assert.equal(dirname(resolve(directory,name)),directory,`${file}: illegal capability ${name}`);else assert.ok(approved.has(name),`${file}: illegal capability ${name}`);
  }ts.forEachChild(n,visit);}visit(tree);
 }
});
test('offline export runs under write permissions limited to sidecar directory; Graph/cache sentinel unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'discovery-permission-')),out=join(dir,'sidecar');
 const graph=join(dir,'graph.json'),cache=join(dir,'analysis-cache.json');await writeFile(graph,'canonical graph sentinel');await writeFile(cache,'standard cache sentinel');
 try{
  const script=`import {runOffline,writeSidecar} from './src/discovery/offline.ts'; const result=await runOffline(); await writeSidecar(${JSON.stringify(out)},result); console.log(result.content.candidates.length);`;
  const r=await promisify(execFile)('node',['--permission','--allow-worker','--allow-fs-read=*',`--allow-fs-write=${out}`,`--allow-fs-write=${out}/*`,'--input-type=module','-e',script],{cwd:process.cwd(),timeout:30000,maxBuffer:100000});
  assert.equal(Number(r.stdout.trim()),13);assert.equal(await readFile(graph,'utf8'),'canonical graph sentinel');assert.equal(await readFile(cache,'utf8'),'standard cache sentinel');
  const sidecar=JSON.parse(await readFile(join(out,'sidecar.json'),'utf8'));assert.equal(sidecar.schemaVersion,'discovery-sidecar@1');assert.ok(sidecar.candidates.every((c:any)=>c.lineageClaim==='none'&&!('relationships'in c)));
 }finally{await rm(dir,{recursive:true,force:true});}
});
