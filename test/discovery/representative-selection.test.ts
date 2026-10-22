import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recommendSources,moduleOf} from '../../experiments/discovery-v2/representative-selection.ts';
import type {SourceDirectory,ListedFile} from '../../experiments/discovery-v2/source-selection.ts';
const file=(path:string,blob=path,bytes=200):ListedFile=>({path,blob,bytes,type:'blob',selectable:true,reason:'supported',language:path.endsWith('.ts')?'typescript':'javascript'});
function directory(repositoryId:number,files:ListedFile[]):SourceDirectory{return {repositoryId,revision:'a'.repeat(40),tree:'b'.repeat(40),fullName:`fixture/repo${repositoryId}`,files,coverage:{scope:'bounded tree listing, not a repository scan',state:'partial',enumeration:'partial',eligibleFiles:files.length,visitedTrees:3,unlistedDirectories:['unread (directory budget)'],filtered:[],reasons:[]}};}
const limits={attempts:24,usedAttempts:10,reservedBytes:327680,totalResponseBytes:1048576,perResponseBytes:32768,totalBytes:2097152,usedBytes:0,filesPerRepository:8};
test('representative selection diversifies modules/languages, suppresses duplicates/config and is independent of provider order',()=>{
 const files=[file('src/a/a.js'),file('src/a/b.js'),file('src/a/c.js'),file('src/b/core.ts'),file('src/c/run.js'),file('vite.config.js'),file('src/d/duplicate.js','src/a/a.js')];
 const a=recommendSources([directory(1,files)],{...limits,maxRecommended:3});
 const b=recommendSources([directory(1,[...files].reverse())],{...limits,maxRecommended:3});assert.deepEqual(a,b);
 const r=a.repositories[0]!;assert.equal(r.selected.length,3);assert.equal(new Set(r.selected.map(s=>s.module)).size,3);assert.ok(r.selected.some(s=>s.language==='typescript'));assert.ok(r.selected.every(s=>!s.path.includes('config')));assert.equal(new Set(r.selected.map(s=>s.blob)).size,3);assert.deepEqual(r.unlistedDirectories,['unread (directory budget)']);assert.match(r.selected[0]!.reason,/module/);
});
test('global HTTP/byte limits reserve final identity checks and distribute fairly without extra enumeration',()=>{
 const repos=[1,4,2].map(id=>directory(id,[file('src/a.js'),file('lib/b.ts')]));
 const r=recommendSources(repos,{...limits,usedAttempts:18,maxRecommended:8});assert.equal(r.repositories.reduce((n,r)=>n+r.selected.length,0),3);assert.ok(r.repositories.every(r=>r.selected.length===1));assert.equal(r.estimatedRequests,6);
 const bytes=recommendSources(repos,{...limits,totalBytes:700,usedBytes:0,maxRecommended:8});assert.equal(bytes.selectedBytes,600);assert.equal(bytes.repositories.reduce((n,r)=>n+r.selected.length,0),3);
 const exhausted=recommendSources(repos,{...limits,usedAttempts:23});assert.equal(exhausted.estimatedRequests,0);assert.ok(exhausted.repositories.every(r=>r.selected.length===0));assert.match(exhausted.reasons.join(),/budget/);
});
test('metadata recommendations explicitly defer content quality and never select unsupported/unselectable files',()=>{
 const f=file('README.md');f.selectable=false;f.language='unsupported';const r=recommendSources([directory(1,[f,file('tiny.js','tiny',22),file('normal.ts','normal',300),file('large.js','large',23000)])],{...limits,maxRecommended:1});assert.equal(r.repositories[0]!.selected[0]!.path,'normal.ts');assert.match(r.scope,/metadata/);assert.deepEqual(r.repositories[0]!.notRecommended.map(f=>f.path).sort(),['README.md','large.js','tiny.js']);assert.equal(moduleOf('packages/parser/src/run.ts'),'packages/parser');assert.equal(moduleOf('src/parser/run.ts'),'src/parser');assert.equal(moduleOf('main.js'),'(root)');
});

test('tiny metadata-only files do not displace informative source merely to add a directory',()=>{
 const r=recommendSources([directory(1,[file('empty.js','empty',43),file('alpha/main.js','main',200),file('alpha/other.js','other',220),file('beta/run.ts','run',300)])],{...limits,maxRecommended:3});assert.ok(r.repositories[0]!.selected.every(f=>f.path!=='empty.js'));
});
