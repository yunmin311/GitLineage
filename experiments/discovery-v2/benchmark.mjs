// Offline only: vendored source is parsed as data; never imported or executed.
import ts from 'typescript';
import { scanDocument } from '../../src/collectors/documents/attribution.ts';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const VERSION = 'js-token-spike@1';
export const BUDGET = { maxBytes:262144, maxTokens:20000, k:5, window:4, permutations:64 };
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function tokens(source, normalize = false) {
  if (Buffer.byteLength(source)>BUDGET.maxBytes) return { state:'skipped_byte_budget', tokens:[] };
  const tree = ts.createSourceFile('data.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if(tree.parseDiagnostics.length) return {state:'parse_failed', tokens:[]};
  const result=[];
  function walk(node) {
    const children=node.getChildren(tree);
    if(children.length) { for(const child of children) walk(child); return; }
    if(node.kind===ts.SyntaxKind.EndOfFileToken) return;
    const text = node.getText(tree);
    if (!text) return;
    result.push({ text:normalize && node.kind===ts.SyntaxKind.Identifier ? '$ID' : text, start:node.getStart(tree), end:node.end });
  }
  walk(tree);
  if(result.length>BUDGET.maxTokens) return {state:'skipped_token_budget', tokens:[]};
  return {state:'complete',tokens:result};
}
export function shingles(values, k=BUDGET.k) {
  const result=[];
  for(let i=0;i<=values.length-k;i++) result.push({hash:hash(JSON.stringify(values.slice(i,i+k))),position:i});
  return result;
}
export function winnow(values, width=BUDGET.window) {
  if(!values.length) return [];
  const result=[]; let previous=-1;
  const actual=Math.min(width,values.length);
  for(let i=0;i<=values.length-actual;i++) {
    let best=i;
    for(let j=i;j<i+actual;j++) if(values[j].hash<=values[best].hash) best=j; // rightmost tie
    if(best!==previous) {result.push(values[best]);previous=best;}
  }
  return result;
}
export function jaccard(a,b) {
  const first=new Set(a), second=new Set(b);
  if(!first.size || !second.size) return null; // unavailable is not a zero result
  let shared=0; for(const item of first) if(second.has(item)) shared++;
  return shared/(first.size+second.size-shared);
}
export function minhash(values) {
  if(!values.length) return null;
  // Stable seeded SHA-256 sketches, independent hashes (not a production fast implementation).
  return Array.from({length:BUDGET.permutations},(_,seed)=>values.reduce((best,value)=>{
    const current=hash(`${seed}:${value}`); return current<best?current:best;
  },'f'.repeat(64)));
}
export function fingerprint(source) {
  const times={},start=performance.now();
  const raw=tokens(source), normalized=tokens(source,true);
  times.parseAndNormalizeMs=performance.now()-start;
  if(raw.state!=='complete') return {state:raw.state};
  let tick=performance.now();
  const strict=shingles(raw.tokens.map(x=>x.text));
  const fuzzy=shingles(normalized.tokens.map(x=>x.text));
  times.shinglesMs=performance.now()-tick;tick=performance.now();
  const w=winnow(fuzzy);times.winnowingMs=performance.now()-tick;tick=performance.now();
  const sketch=minhash([...new Set(fuzzy.map(x=>x.hash))]);times.minhashMs=performance.now()-tick;
  return {state:'complete',blob:createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest('hex'), tokens:raw.tokens.length, strict, fuzzy, winnowing:w, minhash:sketch, timings:times, locations:normalized.tokens};
}
export function compare(a,b,method) {
  if(a.state!=='complete'||b.state!=='complete') return null;
  if(method==='exact_blob') return Number(a.blob===b.blob);
  if(method==='minhash64') return a.minhash && b.minhash ? a.minhash.filter((x,i)=>x===b.minhash[i]).length/BUDGET.permutations:null;
  const field=method==='strict_jaccard'?'strict':method==='normalized_jaccard'?'fuzzy':'winnowing';
  return jaccard(a[field].map(x=>x.hash),b[field].map(x=>x.hash));
}
export function metrics(ranked, positiveIds, k) {
  const top=ranked.slice(0,k), positives=new Set(positiveIds);
  const known=top.filter(x=>x.label!=='unknown');
  const hits=top.filter(x=>positives.has(x.id)).length;
  return { k, returned:top.length, positives:hits, unknown:top.length-known.length, recall: positives.size?hits/positives.size:null, precisionJudged:known.length?hits/known.length:null, precisionLowerBound:hits/k, precisionUpperBound:(hits+top.length-known.length)/k };
}
function changed(source,rename,format) {
  const parsed=tokens(source); if(parsed.state!=='complete') throw new Error(parsed.state);
  const names=new Map(); let n=0;
  // Token-aligned substitution preserves strings/comments; intentionally changes all names, including properties/imports.
  let result='',last=0;
  for(const token of parsed.tokens) {
    const identifier=/^[$A-Z_a-z][$\w]*$/.test(token.text) && !ts.isKeyword(ts.stringToToken(token.text)??ts.SyntaxKind.Identifier);
    let text=token.text;
    if(rename && identifier) {if(!names.has(text)) names.set(text,`renamed${n++}`);text=names.get(text);}
    result+=format?' ':source.slice(last,token.start);
    result+=text; last=token.end;
  }
  result+=format?'\n':source.slice(last);
  return result;
}
export async function loadCorpus() {
  const manifest=JSON.parse(await readFile(new URL('./fixtures/manifest.json',import.meta.url),'utf8'));
  const corpus=[];
  for(const entry of manifest.sources) {
    for(const file of entry.files) {
      const source=await readFile(new URL(`./fixtures/${file.local}`,import.meta.url),'utf8');
      if(hash(source)!==file.sha256) throw new Error(`fixture digest mismatch: ${file.local}`);
      if(file.path==='index.js') corpus.push({id:entry.repository,label:entry.parent==='sindresorhus/p-limit'?'positive':entry.repository==='sindresorhus/p-limit'?'root':'unknown',path:file.path,source,revision:entry.revision});
    }
  }
  const root=corpus.find(x=>x.label==='root');
  corpus.push({id:'synthetic/reinitialized',label:'positive',path:'index.js',source:root.source});
  corpus.push({id:'synthetic/format-path',label:'positive',path:'moved/worker.js',source:changed(root.source,false,true)});
  corpus.push({id:'synthetic/renamed-format-path',label:'positive',path:'lib/renamed.js',source:changed(root.source,true,true)});
  // Independent host implementations share the same third-party template/dependency fragment.
  const template='export function scaffold(value) { if (value === undefined) { throw new TypeError("required"); } return Promise.resolve(value); }\n';
  corpus.push({id:'synthetic/template-only',label:'negative',path:'template.js',source:template});
  corpus.push({id:'synthetic/independent-app',label:'negative',path:'app.js',source:'export function reverse(text) { return [...text].reverse().join(""); }\n'});
  return {manifest,corpus,template};
}
async function verifyReinit(root,copy) {
  const directory=await mkdtemp(join(tmpdir(),'gitlineage-discovery-'));
  try {
    const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Phase0',GIT_AUTHOR_EMAIL:'phase0@example.invalid',GIT_COMMITTER_NAME:'Phase0',GIT_COMMITTER_EMAIL:'phase0@example.invalid',GIT_AUTHOR_DATE:'2020-01-01T00:00:00Z',GIT_COMMITTER_DATE:'2020-01-01T00:00:00Z'};
    const git=(args)=>execFileSync('git',args,{cwd:directory,env,encoding:'utf8',timeout:10000});
    git(['init','--quiet']); await writeFile(join(directory,'index.js'),copy.source);git(['add','--','index.js']);git(['-c','core.hooksPath=/dev/null','commit','--quiet','-m','synthetic reinitialization']);
    const commit=git(['rev-parse','HEAD']).trim(), blob=git(['rev-parse','HEAD:index.js']).trim();
    return {commit,parents:git(['rev-list','--parents','HEAD']).trim().split(' ').slice(1),differsFromPinnedUpstream:commit!==root.revision,blobMatchesSource:blob===fingerprint(root.source).blob};
  } finally {await rm(directory,{recursive:true,force:true});}
}
export async function runBenchmark() {
  const started=performance.now(), cpuStart=process.cpuUsage();
  const {manifest,corpus,template}=await loadCorpus();
  const declarationAudits=[];
  for(const entry of manifest.sources) {
    const file=entry.files.find(x=>x.path==='readme.md'); if(!file) continue;
    const [owner,name]=entry.repository.split('/');
    const scanned=scanDocument({path:file.path,text:await readFile(new URL(`./fixtures/${file.local}`,import.meta.url),'utf8'),root:{provider:'github',owner,name},htmlUrl:`https://github.com/${entry.repository}`});
    declarationAudits.push({repository:entry.repository,revision:entry.revision,scope:'pinned README only; parser recognition does not prove absence',explicitLineageDeclarations:scanned.observations.filter(x=>['derived_from','forked_from'].includes(x.relationship)).length,references:scanned.observations.map(x=>({type:x.relationship,object:x.object,locator:x.evidence.locator}))});
  }
  const costs=[],indexed=new Map();
  for(const item of corpus) {
    const start=performance.now(),cpu=process.cpuUsage();
    indexed.set(item.id,fingerprint(item.source));
    const measuredCpu=process.cpuUsage(cpu);
    costs.push({repository:item.id,bytes:Buffer.byteLength(item.source),tokens:indexed.get(item.id).tokens??null,state:indexed.get(item.id).state,wallMs:performance.now()-start,cpuMs:(measuredCpu.user+measuredCpu.system)/1000,apiCalls:0,phaseMs:indexed.get(item.id).timings});
  }
  const root=corpus.find(x=>x.label==='root'), positives=corpus.filter(x=>x.label==='positive').map(x=>x.id);
  const methods=['exact_blob','strict_jaccard','normalized_jaccard','minhash64','winnowing_jaccard'];
  const results={};
  for(const method of methods) {
    const ranking=corpus.filter(x=>x!==root).map(x=>({id:x.id,label:x.label,score:compare(indexed.get(root.id),indexed.get(x.id),method)})).sort((a,b)=>(b.score??-1)-(a.score??-1)||a.id.localeCompare(b.id));
    // A zero score does not count as a successful retrieval merely because K includes it.
    const eligible=ranking.filter(x=>x.score!==null&&x.score>0);
    results[method]={ranking,metrics:[1,3,5].map(k=>metrics(eligible,positives,k))};
  }
  const renamed=corpus.find(x=>x.id==='synthetic/renamed-format-path');
  const matching= indexed.get(root.id).winnowing.filter(x=>indexed.get(renamed.id).winnowing.some(y=>y.hash===x.hash)).slice(0,5).map(x=>({hash:x.hash,firstPath:root.path,firstToken:x.position,firstOffset:indexed.get(root.id).locations[x.position].start,secondPath:renamed.path,secondToken:indexed.get(renamed.id).winnowing.find(y=>y.hash===x.hash).position}));
  const negativePairs=[
    {name:'identical shared dependency/template',a:template,b:template,label:'negative_host_lineage',explanation:'Identical third-party fragment; no host-to-host derivation by construction.'},
    {name:'generic validators with renamed names',a:'export function validate(value) { if (value === undefined) { throw new TypeError("required"); } return value; }',b:'export function check(input) { if (input === undefined) { throw new TypeError("required"); } return input; }',label:'negative_control',explanation:'Independently specified generic guard idiom; intentional adversarial lexical convergence.'}
  ].map(pair=>({...pair,a:undefined,b:undefined,scores:Object.fromEntries(methods.map(method=>[method,compare(fingerprint(pair.a),fingerprint(pair.b),method)]))}));
  const cpu=process.cpuUsage(cpuStart);
  return {version:VERSION,budget:BUDGET,environment:{node:process.version,typescript:ts.version,platform:process.platform},corpusDigest:hash(JSON.stringify(corpus.map(({id,path,source})=>({id,path,sha256:hash(source)})))),declarationAudits,fixtureRepositories:manifest.sources.map(({repository,revision,parent,license})=>({repository,revision,parent,license})),scope:{repositories:corpus.length,indexedFiles:corpus.length,sourceFilesPerRepository:1,positiveCandidates:positives.length,unknownCandidates:corpus.filter(x=>x.label==='unknown').length,externalRecall:'not measurable; no exhaustive ground truth',offlinePoolCoverage:costs.filter(x=>x.state==='complete').length/corpus.length},reinitialized:await verifyReinit(root,corpus.find(x=>x.id==='synthetic/reinitialized')),results,negativePairs,explanations:matching,costs,usage:{apiCalls:0,githubRateLimitConsumed:0,wallMs:performance.now()-started,cpuMs:(cpu.user+cpu.system)/1000,paidCalls:0},limitations:['one JavaScript file per pinned public repository','fork is older than current upstream; fork metadata proves the positive label, not matching algorithm','identifier normalization deliberately drops binding/property distinctions','thresholds uncalibrated; no global index','unknown public candidates excluded from judged precision, bounds reported','MinHash seeded SHA implementation prioritizes reproducibility over speed']};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const result=await runBenchmark();
  const destination=process.argv[2];
  if(destination) await writeFile(destination,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({digest:result.corpusDigest,scope:result.scope,metrics:Object.fromEntries(Object.entries(result.results).map(([k,v])=>[k,v.metrics])),negativePairs:result.negativePairs,usage:result.usage},null,2));
}
