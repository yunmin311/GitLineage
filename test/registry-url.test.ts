import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PackageRegistryResolver} from '../src/collectors/packages/registry.ts';
import {HttpClient} from '../src/platform/http.ts';
import {Cache} from '../src/platform/cache.ts';
test('unscoped and scoped registry packages resolve their recorded repository without inventing a prefix',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registry-url-')),original=globalThis.fetch;
 const fixture={name:'p-limit',version:'7.1.1',repository:{url:'git+https://github.com/sindresorhus/p-limit.git',type:'git'}};
 globalThis.fetch=async(input)=>{
  const url=String(input);
  if(url==='https://registry.npmjs.org/p-limit/latest'||url==='https://registry.npmjs.org/%40scope/pkg/latest')return new Response(JSON.stringify(fixture),{status:200,headers:{'content-type':'application/json'}});
  return new Response('"Not Found"',{status:404});
 };
 try{const resolver=new PackageRegistryResolver(new HttpClient({cache:new Cache(dir,'public'),allowlist:new Set(['registry.npmjs.org']),maxRetries:0}));
  for(const name of ['p-limit','@scope/pkg']){const result=await resolver.resolve({ecosystem:'npm',name});assert.equal(result?.owner,'sindresorhus');assert.equal(result?.name,'p-limit');}
  await resolver.resolve({ecosystem:'npm',name:'p-limit'});assert.equal(resolver.lookupCount,2);
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

test('registry failure is a diagnostic, not an assertion that repository metadata is absent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'registry-failure-')),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async input=>{calls++;return String(input).includes('/broken/')?new Response('unavailable',{status:503}):new Response('{}',{status:200});};
 try{const resolver=new PackageRegistryResolver(new HttpClient({cache:new Cache(dir,'public'),allowlist:new Set(['registry.npmjs.org']),maxRetries:0}));
  assert.equal(await resolver.resolve({ecosystem:'npm',name:'empty'}),null);assert.equal(resolver.diagnostics.length,0);
  assert.equal(await resolver.resolve({ecosystem:'npm',name:'broken'}),null);assert.equal(resolver.diagnostics.length,1);assert.equal(resolver.diagnostics[0]?.code,'registry_lookup_failed');
  assert.equal(await resolver.resolve({ecosystem:'npm',name:'broken'}),null);assert.equal(calls,2,'failed optional lookups remain memoized, without extra requests');
 }finally{globalThis.fetch=original;await rm(dir,{recursive:true,force:true});}
});

import {collectPackageDependencies} from '../src/collectors/packages/collector.ts';
test('deduplication is not reported as a dependency coverage limit',()=>{
 const manifest={path:'package.json',text:JSON.stringify({dependencies:{alpha:'1',beta:'2'}})},input={root:{provider:'github' as const,owner:'root',name:'example'},commit:'a'.repeat(40),manifests:[manifest,manifest]};
 const complete=collectPackageDependencies(input);assert.equal(complete.facts.length,2);assert.equal(complete.diagnostics.some(d=>d.code==='dependency_limit_applied'),false);
 const limited=collectPackageDependencies({...input,factLimit:1});assert.equal(limited.diagnostics.find(d=>d.code==='dependency_limit_applied')?.context?.dropped,1);
});
