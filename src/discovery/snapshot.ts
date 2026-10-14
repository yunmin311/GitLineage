import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { BudgetLedger } from './budget.ts';
import { validateIdentity } from './contract.ts';
import type { FileClass, FileRecord, SnapshotIdentity } from './contract.ts';
export const FILTER_VERSION='source-filter@1';
export const PARSER_VERSION=`typescript-ast-leaves@1/ts-${ts.version}`;
export interface InputFile {path:string;digest:string;local?:string;content?:string}
export interface SnapshotSpec {identity:SnapshotIdentity;files:InputFile[]}
export interface SourceSnapshot {identity:SnapshotIdentity;files:FileRecord[];sources:{record:FileRecord;content:string}[];state:'completed'|'partial';pending:string[];reasons:string[]}
export const sha256=(data:string|Uint8Array):string=>createHash('sha256').update(data).digest('hex');
export const gitBlob=(data:string|Uint8Array):string=>createHash('sha1').update(`blob ${Buffer.byteLength(data)}\0`).update(data).digest('hex');
export function classify(path:string,content:string):{classification:FileClass;reasons:string[]} {
  const rules:[FileClass,boolean,string][]=[
    ['vendor',/(^|\/)(vendor|third_party|node_modules)(\/|$)/i.test(path),'third-party directory'],
    ['generated',/(^|\/)generated\//i.test(path)||/^.*(?:@generated|DO NOT EDIT)/im.test(content),'generated marker or directory'],
    ['minified',/\.min\.[jt]s$/.test(path)||content.split('\n').some(l=>l.length>2000),'minified filename or long line heuristic'],
    ['lockfile',/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/.test(path),'lockfile name'],
    ['license',/(^|\/)(license|copying)(\.|$)/i.test(path),'license name'],
    ['documentation',/(^|\/)(readme|docs)(\.|\/|$)/i.test(path)||/\.(md|rst|txt)$/.test(path),'documentation name'],
    ['template',/(^|\/)(templates?|boilerplate)\//i.test(path),'explicit scaffold directory'],
    ['unsupported',! /\.[cm]?[jt]s$/.test(path),'only JS and TS supported'],
    ['too_small',Buffer.byteLength(content)<20,'less than 20 bytes'],
  ];
  const found=rules.find(([,match])=>match);return found?{classification:found[0],reasons:[found[2]]}:{classification:'application_source',reasons:['supported source; no exclusion heuristic matched']};
}
/** Each read syscall has a debit first. Bounded UTF-8 fixture input only; no symlinks. */
export async function readBoundedFile(local:string,key:string,path:string,ledger:BudgetLedger):Promise<Buffer> {
  ledger.file(key,path);const handle=await open(local,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile())throw new Error('not a regular fixture file');
    ledger.bytes(key,path,stat.size);const buffer=Buffer.alloc(stat.size);let offset=0;
    while(offset<buffer.length){ledger.guard();const {bytesRead}=await handle.read(buffer,offset,Math.min(16384,buffer.length-offset),offset);if(!bytesRead)throw new Error('snapshot shortened during read');offset+=bytesRead;}
    // Prevent unnoticed growth: metadata and digest must still agree, without reading unreserved bytes.
    if((await handle.stat()).size!==stat.size)throw new Error('snapshot size changed');return buffer;
  }finally{await handle.close();}
}
export async function readSnapshot(spec:SnapshotSpec,ledger:BudgetLedger):Promise<SourceSnapshot> {
  validateIdentity(spec.identity);const result:SourceSnapshot={identity:structuredClone(spec.identity),files:[],sources:[],state:'completed',pending:[],reasons:[]};
  const key=`${spec.identity.provider}:${spec.identity.fullName}@${spec.identity.revision}`;
  const seen=new Set<string>();
  for(const f of [...spec.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){
    try{
      if(f.path.startsWith('/')||f.path.includes('\\')||f.path.split('/').some(s=>!s||s==='.'||s==='..')||seen.has(f.path))throw new Error('invalid or duplicate snapshot path');seen.add(f.path);
      let bytes:Buffer;
      if(f.local!==undefined){bytes=await readBoundedFile(f.local,key,f.path,ledger);}else if(f.content!==undefined){ledger.file(key,f.path);ledger.bytes(key,f.path,Buffer.byteLength(f.content));bytes=Buffer.from(f.content);}else throw new Error('snapshot content missing');
      if(sha256(bytes)!==f.digest)throw new Error('snapshot digest mismatch');
      const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes),filter=classify(f.path,content);
      const record:FileRecord={path:f.path,digest:f.digest,blob:gitBlob(bytes),bytes:bytes.length,language:/\.[cm]?js$/.test(f.path)?'javascript':/\.[cm]?ts$/.test(f.path)?'typescript':'unknown',parserVersion:PARSER_VERSION,filterVersion:FILTER_VERSION,...filter};
      result.files.push(record);if(filter.classification==='application_source')result.sources.push({record,content});
    }catch(error){result.state='partial';result.pending.push(f.path);result.reasons.push(`${f.path}: ${error instanceof Error?error.message:String(error)}`);}
  }
  return result;
}
