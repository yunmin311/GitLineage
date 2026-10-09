import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidate } from '../../src/discovery/contract.ts';
export function candidateFixture() {
  const identity = { provider: 'github', repositoryId: null, completeness: 'name_only', fullName: 'test/root', aliases: [], revision: 'a'.repeat(40) };
  return { schemaVersion: 'discovery-candidate@1', target: identity, candidate: { ...identity, fullName: 'test/other', revision: 'b'.repeat(40) },
    discoveries: [{ source: 'fixed_pool', version: '1', reason: 'explicit offline fixture', locator: 'fixture.json' }],
    similarity: [], files: { target: [], candidate: [] }, checks: [{ kind: 'similarity', state: 'unexecuted', reasons: ['pending'] }],
    verification: { state: 'pending', checks: [], canonicalEvidenceIds: [] }, lineageClaim: 'none',
    coverage: { state: 'unexecuted', expectedPairs: 0, comparedPairs: 0, pending: [], reasons: ['pending'] },
    usage: { attempts: 0, searchAttempts: 0, candidates: 0, files: {}, bytesByFile: {}, totalBytes: 0, activeWorkers: 0, peakWorkers: 0 },
  };
}
test('valid pending candidate has no invented scores or lineage', () => { assert.doesNotThrow(() => validateCandidate(candidateFixture())); });
test('malformed candidate cannot enter a sidecar', () => {
  for (const patch of [ { relationship: 'derived_from' }, { lineageClaim: 'VERIFIED' }, { verification: {state:'VERIFIED'} }, { target: {revision:'main'} }, { usage: {totalBytes:-1} } ]) {
    assert.throws(() => validateCandidate({ ...candidateFixture(), ...patch }));
  }
});
test('unknown and incomplete measurements cannot masquerade as zero similarity; nested unknown fields rejected', () => {
  const c = candidateFixture() as unknown as Record<string, any>;
  const file = {path:'index.js',digest:'c'.repeat(64),blob:'a'.repeat(40),bytes:50,language:'javascript',parserVersion:'ts@5',filterVersion:'filter@1',classification:'application_source',reasons:['source']};
  c.files={target:[file],candidate:[file]};
  const m={method:'strict_token5',version:'1',parserVersion:'ts@5',filterVersion:'filter@1',state:'unavailable',score:null,firstPath:'index.js',secondPath:'index.js',firstDigest:file.digest,secondDigest:file.digest,firstTokens:null,secondTokens:null,sharedShingles:null,firstShingles:null,secondShingles:null,firstCoverage:null,secondCoverage:null,ranges:[],rangesTruncated:false,reasons:['parse_failed']};
  c.similarity=[m]; assert.doesNotThrow(()=>validateCandidate(c));
  for(const patch of [{score:0},{state:'VERIFIED'},{score:NaN},{score:1.1},{score:-1},{revision:'latest'}])assert.throws(()=>validateCandidate({...c,similarity:[{...m,...patch}]}));
  assert.throws(()=>validateCandidate({...c,target:{...c.target,repositoryId:42}}));
  assert.throws(()=>validateCandidate({...c,target:{...c.target,revision:'abc'}}));
  const complete={...m,state:'completed',score:1,firstTokens:5,secondTokens:5,firstShingles:1,secondShingles:1,sharedShingles:1,firstCoverage:1,secondCoverage:1};
  assert.doesNotThrow(()=>validateCandidate({...c,similarity:[complete]}));
  assert.throws(()=>validateCandidate({...c,similarity:[{...complete,score:.5}]}));
});
