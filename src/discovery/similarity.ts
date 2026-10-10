// CPU work lives in the worker. Source is data, never executed.
import ts from 'typescript';
import type { Measurement, MatchRange } from './contract.ts';
import type { SourceSnapshot } from './snapshot.ts';
import { sha256 } from './snapshot.ts';
export const METHOD_VERSION='token5-set@1';
const MAX_TOKENS=20000,MAX_RANGES=12;
type Token={text:string;normalized:string;start:number;end:number};
type Fingerprint={tokens:Token[];strict:Map<string,number>;normalized:Map<string,number>;error:string|null};
function fingerprint(content:string,path:string):Fingerprint {
  const tokens:Token[]=[],strict=new Map<string,number>(),normalized=new Map<string,number>();
  try{
    const tree=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,/\.[cm]?ts$/.test(path)?ts.ScriptKind.TS:ts.ScriptKind.JS);
    if((tree as ts.SourceFile & {parseDiagnostics:unknown[]}).parseDiagnostics.length)throw new Error('parse_failed');
    const stack:ts.Node[]=[tree];
    while(stack.length){const node=stack.pop()!,children=node.getChildren(tree);
      if(children.length){for(let i=children.length-1;i>=0;i--)stack.push(children[i]!);continue;}
      if(node.kind===ts.SyntaxKind.EndOfFileToken)continue;const text=node.getText(tree);if(!text)continue;
      if(tokens.length>=MAX_TOKENS)throw new Error('token_budget');
      tokens.push({text,normalized:node.kind===ts.SyntaxKind.Identifier?'$ID':text,start:node.getStart(tree),end:node.end});
    }
    if(tokens.length<5)throw new Error('insufficient_tokens');
    for(let i=0;i<=tokens.length-5;i++){
      const window=tokens.slice(i,i+5);const a=sha256(JSON.stringify(window.map(t=>t.text))),b=sha256(JSON.stringify(window.map(t=>t.normalized)));
      if(!strict.has(a))strict.set(a,i);if(!normalized.has(b))normalized.set(b,i);
    }
    return{tokens,strict,normalized,error:null};
  }catch(e){return{tokens:[],strict,normalized,error:e instanceof Error?e.message:String(e)};}
}
function setStats(a:Set<string>,b:Set<string>) {const shared=[...a].filter(x=>b.has(x)).length;return{shared,first:a.size,second:b.size,score:a.size&&b.size?shared/(a.size+b.size-shared):null,firstCoverage:a.size?shared/a.size:null,secondCoverage:b.size?shared/b.size:null};}
export function compareSnapshots(first:SourceSnapshot,second:SourceSnapshot) {
  const a=first.sources.map(f=>({f,p:fingerprint(f.content,f.record.path)})),b=second.sources.map(f=>({f,p:fingerprint(f.content,f.record.path)}));
  const measurements:Measurement[]=[];
  for(const x of a)for(const y of b){
    const common={version:METHOD_VERSION,parserVersion:x.f.record.parserVersion,filterVersion:x.f.record.filterVersion,
      firstPath:x.f.record.path,secondPath:y.f.record.path,firstDigest:x.f.record.digest,secondDigest:y.f.record.digest,
      firstTokens:x.p.error?null:x.p.tokens.length,secondTokens:y.p.error?null:y.p.tokens.length,rangesTruncated:false,reasons:[] as string[]};
    // Exact bytes remain measurable even if a supported source cannot parse.
    measurements.push({...common,method:'exact_blob',version:'git-blob-sha1@1',state:'completed',score:Number(x.f.record.blob===y.f.record.blob),sharedShingles:null,firstShingles:null,secondShingles:null,firstCoverage:null,secondCoverage:null,ranges:[]});
    for(const method of ['strict_token5','normalized_token5'] as const){
      const field=method==='strict_token5'?'strict':'normalized';
      if(x.p.error||y.p.error){measurements.push({...common,method,state:'unavailable',score:null,sharedShingles:null,firstShingles:null,secondShingles:null,firstCoverage:null,secondCoverage:null,ranges:[],reasons:[x.p.error,y.p.error].filter((v):v is string=>v!==null)});continue;}
      const ax=x.p[field],by=y.p[field],shared=[...ax.keys()].filter(k=>by.has(k)).sort();const ranges:MatchRange[]=shared.slice(0,MAX_RANGES).map(hash=>{
        const i=ax.get(hash)!,j=by.get(hash)!;return{first:[i,i+5],second:[j,j+5],firstChars:[x.p.tokens[i]!.start,x.p.tokens[i+4]!.end],secondChars:[y.p.tokens[j]!.start,y.p.tokens[j+4]!.end],fingerprint:hash};
      });const stats=setStats(new Set(ax.keys()),new Set(by.keys()));
      measurements.push({...common,method,state:'completed',score:stats.score,sharedShingles:stats.shared,firstShingles:stats.first,secondShingles:stats.second,firstCoverage:stats.firstCoverage,secondCoverage:stats.secondCoverage,ranges,rangesTruncated:shared.length>MAX_RANGES});
    }
  }
  const failures=[...a,...b].filter(x=>x.p.error).map(x=>`${x.f.record.path}: ${x.p.error}`);
  const complete=first.state==='completed'&&second.state==='completed'&&failures.length===0&&a.length>0&&b.length>0;
  const aggregate=(field:'strict'|'normalized')=>{
    const ax=new Set(a.filter(x=>!x.p.error).flatMap(x=>[...x.p[field].keys()])),by=new Set(b.filter(x=>!x.p.error).flatMap(x=>[...x.p[field].keys()]));
    const stats=setStats(ax,by);return{...stats,score:complete?stats.score:null,firstCoverage:complete?stats.firstCoverage:null,secondCoverage:complete?stats.secondCoverage:null};
  };
  return {measurements,summary:{state:complete?'completed':a.length&&b.length?'partial':'unavailable',strict:aggregate('strict'),normalized:aggregate('normalized'),
    firstTokens:a.reduce((sum,x)=>sum+x.p.tokens.length,0),secondTokens:b.reduce((sum,x)=>sum+x.p.tokens.length,0),
    firstIncluded:a.length,secondIncluded:b.length,firstFiltered:first.files.length-a.length,secondFiltered:second.files.length-b.length,
    exactPairs:measurements.filter(m=>m.method==='exact_blob'&&m.score===1).length,expectedPairs:a.length*b.length,comparedPairs:a.length*b.length,failures}};
}
