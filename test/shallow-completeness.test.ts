import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareHistories } from '../src/collectors/git/history.ts';
import type { HistorySample } from '../src/collectors/git/history.ts';
test('real shallow subset with fewer than depth*5 commits must not prove derivation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shallow-boundary-'));
 try{
  const origin=join(dir,'origin');await mkdir(origin);
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'test',GIT_COMMITTER_EMAIL:'test@example.invalid'};
  const git=(cwd:string,args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd,env,encoding:'utf8'}).trim();
  git(origin,['init','--quiet']);for(let i=0;i<6;i++){await writeFile(join(origin,'data'),String(i));git(origin,['add','data']);git(origin,['commit','--quiet','-m',`step ${i}`]);}
  const shallow=join(dir,'shallow');git(dir,['clone','--quiet','--depth=2',`file://${origin}`,shallow]);
  const commits=git(shallow,['rev-list','HEAD']).split('\n'),all=git(origin,['rev-list','HEAD']).split('\n');
  assert.equal(commits.length,2);assert.equal(git(shallow,['rev-parse','--is-shallow-repository']),'true');
  const root={provider:'github',owner:'synthetic',name:'shallow'} as const,candidate={provider:'github',owner:'synthetic',name:'full'} as const;
  const rootSample:HistorySample={ref:root,commits,truncated:commits.length>=10,createdAt:'2021-01-01',htmlUrl:'https://github.com/synthetic/shallow',fetch:{isShallow:true,shallowBoundary:(await readFile(join(shallow,'.git','shallow'),'utf8')).trim().split('\n')}};
  const result=compareHistories({root,rootSample,candidates:[{ref:candidate,commits:all,truncated:false,createdAt:'2020-01-01',htmlUrl:'https://github.com/synthetic/full',fetch:{isShallow:false}}]});
  assert.ok(result.observations.some(o=>o.relationship==='shares_history_with'));
  assert.ok(!result.observations.some(o=>o.relationship==='derived_from'),'shallow containment is not complete history');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unknown fetch completeness and contradictory boundary never promote containment; known complete histories still do',()=>{
 const root={provider:'github',owner:'a',name:'new'} as const,candidate={provider:'github',owner:'a',name:'old'} as const;
 for(const fetch of [{},{isShallow:true},{isShallow:false,shallowBoundary:['a'.repeat(40)]},{isShallow:false}]){
  const result=compareHistories({root,rootSample:{ref:root,commits:['a'.repeat(40)],truncated:false,createdAt:'2021-01-01',htmlUrl:'https://github.com/a/new',fetch},candidates:[{ref:candidate,commits:['a'.repeat(40),'b'.repeat(40)],truncated:false,createdAt:'2020-01-01',htmlUrl:'https://github.com/a/old',fetch:{isShallow:false}}]});
  assert.equal(result.observations.some(o=>o.relationship==='derived_from'),fetch.isShallow===false&&!('shallowBoundary'in fetch));
  assert.ok(result.observations.some(o=>o.relationship==='shares_history_with'));
 }
});
