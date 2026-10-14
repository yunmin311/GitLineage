import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens, fingerprint, compare, winnow, metrics, loadCorpus, runBenchmark } from './benchmark.mjs';
test('tokenization preserves literal content and regex but drops comments/trivia',()=>{
  const a='const regex = /a\\/b/g; const text = "// not comment"; // comment\n';
  const b='const regex=/a\\/b/g;const text="// not comment";';
  assert.deepEqual(tokens(a).tokens.map(x=>x.text),tokens(b).tokens.map(x=>x.text));
  assert.ok(tokens(a).tokens.some(x=>x.text==='"// not comment"'));
  assert.equal(compare(fingerprint(a),fingerprint(b),'strict_jaccard'),1);
});
test('parse failures and budget exhaustion remain unavailable, never negative results',()=>{
  assert.equal(tokens('const = ;').state,'parse_failed');
  assert.equal(tokens('let a=1;'.repeat(5001)).state,'skipped_token_budget');
  const skipped=fingerprint(' '.repeat(262145));
  assert.equal(skipped.state,'skipped_byte_budget');
  assert.equal(compare(skipped,fingerprint('const a = 1;'),'exact_blob'),null);
});
test('winnowing uses rightmost equal minimum with positions',()=>{
  assert.deepEqual(winnow([{hash:'a',position:0},{hash:'a',position:1},{hash:'b',position:2}],2),[{hash:'a',position:1}]);
});
test('metrics do not label unknown as positive and penalize underfilled K',()=>{
  const result=metrics([{id:'p',label:'positive'},{id:'u',label:'unknown'}],['p'],5);
  assert.equal(result.recall,1);assert.equal(result.precisionJudged,1);
  assert.equal(result.precisionLowerBound,.2);assert.equal(result.precisionUpperBound,.4);
});
test('pinned corpus has legal files and intentionally unknown real projects',async()=>{
  const {manifest,corpus}=await loadCorpus();
  assert.ok(manifest.sources.every(x=>x.license==='MIT'&&/^[a-f0-9]{40}$/.test(x.revision)));
  assert.equal(corpus.filter(x=>x.label==='unknown').length,2);
  assert.equal(corpus.find(x=>x.id==='synthetic/renamed-format-path').path,'lib/renamed.js');
});
test('benchmark recovers transformed source, exposes template confounds, reinitializes history offline',async()=>{
  const a=await runBenchmark(),b=await runBenchmark();
  assert.equal(a.corpusDigest,b.corpusDigest);assert.deepEqual(a.results,b.results);
  assert.equal(a.reinitialized.blobMatchesSource,true);assert.equal(a.reinitialized.differsFromPinnedUpstream,true);
  assert.deepEqual(a.reinitialized.parents,[]);
  assert.equal(a.results.exact_blob.metrics[2].recall,.25);
  assert.equal(a.results.normalized_jaccard.metrics[2].recall,1);
  assert.equal(a.negativePairs[1].scores.normalized_jaccard,1);
  assert.equal(a.usage.apiCalls,0);
  assert.ok(a.explanations.every(x=>x.firstPath&&x.secondPath&&x.hash));
});
