import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {officialFixture} from '../../experiments/discovery-v2/phase1d-mock.ts';
import {validatePreviewExport} from '../../experiments/discovery-v2/preview-contract.ts';

test('download export binds all observed search reasons to search task, comparison and pinned IDs',async()=>{
 const f=officialFixture(),p=createPreview({transport:f.transport,cooldownMs:0});
 const s=p.startSearch('root/example');await p.wait(s.id);
 const found=s.search!.result!.candidates.find(c=>c.candidate.repositoryId===4)!;
 // Multiple valid observations from the search result must survive selection.
 found.discoveries.push({...found.discoveries[0]!,reason:'second valid discovery observation',rank:2});
 const c=p.startCompare(s.id,[4]);await p.wait(c.id);
 const exported=JSON.parse(JSON.stringify(c.export));validatePreviewExport(exported);
 assert.equal(exported.schemaVersion,'discovery-preview-export@1');
 assert.equal(exported.provenance.searchTaskId,s.id);assert.equal(exported.provenance.compareTaskId,c.id);
 assert.deepEqual(exported.provenance.candidates[0]!.searchCandidate.discoveries,found.discoveries);
 assert.equal(exported.provenance.candidates[0]!.repositoryId,4);
 assert.equal(exported.provenance.candidates[0]!.revision,f.repos[3]!.revision);
 assert.match(exported.probe.content.comparisons[0]!.candidate!.discoveries[0]!.locator,/query=/);
 assert.equal(exported.probe.content.comparisons[0]!.candidate!.discoveries[0]!.source,'repository_search');
 exported.provenance.candidates[0]!.repositoryId=2;assert.throws(()=>validatePreviewExport(exported));
});
