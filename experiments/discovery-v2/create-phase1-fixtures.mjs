// Offline fixture construction only. Executes Git, never repository source.
import {readFile,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base=new URL('./fixtures/',import.meta.url);
const root=await readFile(new URL('sindresorhus--p-limit--index.js',base),'utf8');
const license=await readFile(new URL('sindresorhus--p-limit--license',base),'utf8');
const guard='export function validate(value) { if (value === undefined) throw new TypeError("required"); return Promise.resolve(value); }\n';
const reverse='export function reverse(text) { return [...text].reverse().join(""); }\n';
const sum='export function sum(values) { return values.reduce((total, value) => total + value, 0); }\n';
const rename='export function sum(items) { return items.reduce((accumulator, item) => accumulator + item, 0); }\n';
const template='export function scaffold(value) { return Promise.resolve(value).then(result => ({result})); }\n';
const filtered={'vendor/sdk.js':guard,'generated/types.js':'// @generated\n'+guard,'lib/x.min.js':guard,'package-lock.json':'{"lockfileVersion":3}','LICENSE':license,'README.md':'# Independent application\nShared documentation template.','tiny.js':'x','thing.py':'print("unsupported language")','templates/scaffold.js':template};
const defs=[
 ['copy-reinit',{'index.js':root,'LICENSE':license}],
 ['format-path',{'lib/moved.js':'\n\n'+root.replaceAll('\t','  '),'LICENSE':license}],
 ['logic-root',{'src/sum.js':sum}], ['logic-renamed',{'src/add.js':rename}],
 ['template-app-a',{'templates/scaffold.js':template,'src/app.js':sum,'LICENSE':license,'README.md':filtered['README.md']}],
 ['template-app-b',{'templates/scaffold.js':template,'src/app.js':reverse,'LICENSE':license,'README.md':filtered['README.md']}],
 ['generic-a',{'src/guard.js':guard,'src/app.js':sum}],
 ['generic-b',{'lib/check.js':guard.replaceAll('value','input'),'src/app.js':reverse}],
 ['small-shared',{'src/guard.js':guard}],
 ['large-shared',{'src/guard.js':guard,...Object.fromEntries(Array.from({length:16},(_,i)=>[`src/module-${i}.js`,`export function task${i}(input) { const marker = "module-${i}"; return input.map(row => [row, marker, ${i}]).filter(entry => entry.length > ${i%3}); }\n`]))}],
 ['filtered-mix',{'src/app.js':reverse,...filtered}],
 ['broken',{'src/parse.js':'export const broken = ; // malformed source'}],
 ['small-only',{'tiny.js':'x'}],
];
const cases=[
 ['sindresorhus/p-limit','synthetic/copy-reinit','positive','Source copied into an independent initial Git commit; synthetic'],
 ['sindresorhus/p-limit','synthetic/format-path','positive','Only indentation, leading whitespace and path changed; synthetic'],
 ['sindresorhus/p-limit','jucke/p-limit','positive','Pinned Phase 0 public fork metadata and shared commit'],
 ['sindresorhus/p-limit','sindresorhus/yocto-queue','unknown','Real candidate without human lineage validation'],
 ['sindresorhus/p-limit','sindresorhus/p-throttle','unknown','Real candidate without human lineage validation'],
 ['synthetic/logic-root','synthetic/logic-renamed','positive','Manual lexical binding renames only; reduce property, literals and operators unchanged'],
 ['synthetic/template-app-a','synthetic/template-app-b','negative','Independently constructed apps share only scaffold/license/README'],
 ['synthetic/generic-a','synthetic/generic-b','negative','Independent apps with common guard; no lineage by construction'],
 ['synthetic/small-shared','synthetic/large-shared','negative','Independent large project includes the same generic guard'],
 ['synthetic/large-shared','synthetic/small-shared','negative','Reverse asymmetric pair; same shared generic guard'],
 ['sindresorhus/p-limit','synthetic/filtered-mix','negative','Independent application with deliberately non-source fixtures'],
 ['sindresorhus/p-limit','synthetic/broken','unknown','Parse failure cannot be negative'],
 ['sindresorhus/p-limit','synthetic/small-only','unknown','No eligible source cannot be negative'],
];
const dir=await mkdtemp(join(tmpdir(),'discovery-fixtures-'));
try {
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Discovery fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Discovery fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2020-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2020-01-01T00:00:00Z'};
 const sources=[];
 for(const [name,files]of defs){const repo=join(dir,name);await mkdir(repo);const git=args=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:repo,env,encoding:'utf8'}).trim();git(['init','--quiet']);
  for(const [path,content]of Object.entries(files)){await mkdir(dirname(join(repo,path)),{recursive:true});await writeFile(join(repo,path),content);}
  git(['add','--all']);git(['commit','--quiet','-m','fixed synthetic fixture']);const revision=git(['rev-parse','HEAD']);
  sources.push({repository:`synthetic/${name}`,revision,parents:[],synthetic:true,files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,content,sha256:createHash('sha256').update(content).digest('hex')}))});
 }
 await writeFile(new URL('./phase1-fixtures.json',import.meta.url),JSON.stringify({version:'synthetic-multifile@1',construction:'create-phase1-fixtures.mjs; independent Git roots, never real human labels',sources,cases:cases.map(([target,candidate,label,reason])=>({target,candidate,label,reason}))},null,2)+'\n');
}finally{await rm(dir,{recursive:true,force:true});}
