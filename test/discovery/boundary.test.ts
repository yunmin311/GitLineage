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
test('Repository Search writes only experimental sidecar under filesystem permissions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'search-permission-')),out=join(dir,'sidecar');
 const graph=join(dir,'graph.json'),cache=join(dir,'analysis-cache.json');await writeFile(graph,'canonical graph sentinel');await writeFile(cache,'standard cache sentinel');
 try{
  const script=`import {buildQueryPlan,discoverRepositories} from './src/discovery/search.ts';import {writeSearchSidecar} from './src/discovery/search-output.ts';const target={provider:'github',repositoryId:1,completeness:'provider_id',fullName:'test/root',aliases:[],revision:'a'.repeat(40)};const result=await discoverRepositories(buildQueryPlan(target,{}),{transport:async()=>new Response('{"total_count":1,"incomplete_results":false,"items":[{"id":2,"full_name":"other/root","html_url":"https://github.com/other/root"}]}')});await writeSearchSidecar(${JSON.stringify(out)},result);`;
  await promisify(execFile)('node',['--permission','--allow-fs-read=*',`--allow-fs-write=${out}`,`--allow-fs-write=${out}/*`,'--input-type=module','-e',script],{cwd:process.cwd(),timeout:10000,maxBuffer:100000});
  assert.equal(await readFile(graph,'utf8'),'canonical graph sentinel');assert.equal(await readFile(cache,'utf8'),'standard cache sentinel');
  const r=JSON.parse(await readFile(join(out,'search-sidecar.json'),'utf8'));assert.equal(r.schemaVersion,'discovery-search-sidecar@2');assert.equal(r.candidates.length,1);assert.equal(r.usage.totalBytes,0);assert.equal(r.candidates[0].lineageClaim,'none');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('production source does not import Discovery',async()=>{
 async function visitDirectory(directory:string):Promise<void>{for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory()){if(path!==resolve('src/discovery'))await visitDirectory(path);}else if(entry.name.endsWith('.ts')){
  const tree=ts.createSourceFile(path,await readFile(path,'utf8'),ts.ScriptTarget.Latest,true);
  const visit=(n:ts.Node):void=>{if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)){const spec=n.moduleSpecifier;if(spec&&ts.isStringLiteral(spec))assert.ok(!spec.text.includes('/discovery/'),path);}if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))assert.ok(!n.arguments[0].text.includes('/discovery/'),path);ts.forEachChild(n,visit);};visit(tree);
 }}}
 await visitDirectory(resolve('src'));
});

test('Discovery module loading and query construction perform no network I/O',async()=>{
 const script=`let calls=0;globalThis.fetch=()=>{calls++;throw new Error('unexpected network');};const {buildQueryPlan}=await import('./src/discovery/search.ts');await import('./src/discovery/search-output.ts');buildQueryPlan({provider:'github',repositoryId:1,completeness:'provider_id',fullName:'test/root',aliases:[],revision:'a'.repeat(40)},{});console.log(calls);`;
 const r=await promisify(execFile)('node',['--input-type=module','-e',script],{cwd:process.cwd(),timeout:10000,maxBuffer:100000});
 assert.equal(r.stdout.trim(),'0');
});
