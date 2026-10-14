// Explicit bounded public-data acquisition. No credentials are persisted.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolveGitHubToken } from '../../src/platform/http.ts';
if (!process.argv.includes('--refresh')) throw new Error('Network acquisition requires explicit --refresh; benchmark.mjs is offline.');
const base = new URL('./fixtures/', import.meta.url);
await mkdir(base, { recursive: true });
const token = await resolveGitHubToken();
const probes = []; let calls = 0;
async function get(url, authenticated = true) {
  if (++calls > 24) throw new Error('24-request hard acquisition cap');
  const headers = { 'User-Agent': 'GitLineage-Phase0', Accept: 'application/vnd.github+json' };
  if (token && authenticated && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
  const start = performance.now();
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
  const reader = response.body?.getReader();
  const chunks=[]; let size=0;
  if (reader) while (true) {
    const {done,value}=await reader.read(); if(done) break;
    size+=value.length;
    if(size>262144) {await reader.cancel(); throw new Error('fixture/probe response exceeds 256KiB');}
    chunks.push(value);
  }
  const bytes=Buffer.concat(chunks,size);
  const body = new TextDecoder().decode(bytes);
  const record = { url, status: response.status, authenticated: Boolean(token && authenticated && url.startsWith('https://api.github.com/')), bytes: bytes.length, latencyMs: performance.now() - start, rate: Object.fromEntries(['limit','remaining','used','reset','resource'].map(k => [k, response.headers.get(`x-ratelimit-${k}`)])) };
  probes.push(record);
  let json; try { json = JSON.parse(body); } catch {}
  if (json?.items) Object.assign(record, {totalCount:json.total_count,incompleteResults:json.incomplete_results,items:json.items.map(x=>x.full_name??`${x.repository?.full_name}:${x.path}`)});
  return { response, body, json };
}
const upstream = 'sindresorhus/p-limit';
const forkList = await get(`https://api.github.com/repos/${upstream}/forks?sort=oldest&per_page=1`);
if (!forkList.response.ok) throw new Error('fork list unavailable');
const fork = forkList.json[0].full_name;
const sources = [];
for (const repository of [upstream, fork, 'sindresorhus/yocto-queue', 'sindresorhus/p-throttle']) {
  const metadata = await get(`https://api.github.com/repos/${repository}`);
  if (!metadata.response.ok || !metadata.json?.default_branch) throw new Error('metadata unavailable');
  if(metadata.json.license?.spdx_id !== 'MIT') throw new Error('fixture license requires review');
  const commit = await get(`https://api.github.com/repos/${repository}/commits/${metadata.json.default_branch}`);
  if (!metadata.response.ok || !commit.response.ok) throw new Error('source unavailable');
  const revision = commit.json.sha;
  const files = [];
  for (const path of (repository === 'sindresorhus/yocto-queue' || repository === 'sindresorhus/p-throttle' ? ['index.js','license','readme.md'] : ['index.js','license'])) {
    const fetched = await get(`https://raw.githubusercontent.com/${repository}/${revision}/${path}`);
    if (!fetched.response.ok) throw new Error(`missing ${repository}/${path}`);
    const local = `${repository.replace('/','--')}--${path}`;
    await writeFile(new URL(local, base), fetched.body);
    files.push({ path, local, sha256: createHash('sha256').update(fetched.body).digest('hex'), url: `https://github.com/${repository}/blob/${revision}/${path}` });
  }
  sources.push({ repository, revision, license: metadata.json.license?.spdx_id, fork:metadata.json.fork, parent:metadata.json.parent?.full_name??null, source:metadata.json.source?.full_name??null, commitParents:commit.json.parents.map(x=>x.sha), files });
}
const sharedCommit = await get(`https://api.github.com/repos/${upstream}/commits/${sources[1].revision}`);
if (sharedCommit.response.ok && sharedCommit.json.sha === sources[1].revision) sources[1].sharedCommitAvailableInUpstream = sharedCommit.json.sha;
for(const query of ['p-limit in:name language:JavaScript fork:true','"concurrency" "promise" in:description language:JavaScript']) await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`);
await get(`https://api.github.com/search/code?q=${encodeURIComponent('"activeCount" repo:sindresorhus/p-limit language:JavaScript')}&per_page=3`);
await get(`https://api.github.com/search/code?q=${encodeURIComponent('"activeCount" repo:sindresorhus/p-limit')}&per_page=1`, false);
await writeFile(new URL('manifest.json', base), JSON.stringify({ acquiredAt: new Date().toISOString(), sources, forkSelection:'oldest first public fork; one page, one result', labels:'fork parent metadata is known; other public pairs remain unknown; synthetic labels defined by construction' }, null, 2)+'\n');
await writeFile(new URL('../api-probes.json', base), JSON.stringify({ acquiredAt:new Date().toISOString(), requestCap:24, requests:calls, probes }, null, 2)+'\n');
console.log(JSON.stringify({ requests:calls,sources:sources.map(x=>({repository:x.repository,revision:x.revision,license:x.license,parent:x.parent})),probes:probes.filter(x=>x.url.includes('/search/')).map(x=>({status:x.status,authenticated:x.authenticated,items:x.items,rate:x.rate})) },null,2));
