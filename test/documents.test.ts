import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDocument, isScannableDocument } from '../src/collectors/documents/attribution.ts';
import type { EntityRef, Observation } from '../src/core/model.ts';

const root = { provider: 'github', owner: 'me', name: 'myproject' } as const;

function relationships(observations: readonly Observation[]): { type: string; target: string }[] {
  return observations.map((observation) => {
    const object: EntityRef = observation.object;
    const target = object.kind === 'repository' ? `${object.owner}/${object.name}` : `${object.kind}:${'name' in object ? object.name : ''}`;
    return { type: observation.relationship, target };
  });
}

test('a bare link produces references, never declared_inspiration', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'We would like to thank https://github.com/foo/bar for the idea.\n',
    root,
    htmlUrl: 'https://github.com/me/myproject/blob/main/README.md',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'references', target: 'foo/bar' }]);
  const evidence = result.observations[0]?.evidence;
  assert.equal(evidence?.type, 'document_reference');
});

test('an explicit inspiration phrase with a nearby URL produces declared_inspiration', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'This project is inspired by https://github.com/gitdiagram/gitdiagram and builds on it.\n',
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'declared_inspiration', target: 'gitdiagram/gitdiagram' }]);
  assert.equal(result.observations[0]?.evidence.status, 'DECLARED');
  assert.equal(result.observations[0]?.evidence.data.phrase, 'inspired by');
  assert.equal(result.observations[0]?.evidence.data.line_start, 1);
});

test('each declaration phrase maps to exactly one relationship type', () => {
  const cases: readonly [string, string][] = [
    ['Inspired by https://github.com/a/b', 'declared_inspiration'],
    ['Based on https://github.com/a/b', 'declared_inspiration'],
    ['Originally based on https://github.com/a/b', 'declared_inspiration'],
    ['Derived from https://github.com/a/b', 'derived_from'],
    ['Adapted from https://github.com/a/b', 'derived_from'],
    ['Port of https://github.com/a/b', 'derived_from'],
    ['Fork of https://github.com/a/b', 'forked_from'],
    ['Thanks to https://github.com/a/b', 'references'],
  ];
  for (const [line, expected] of cases) {
    const result = scanDocument({ path: 'NOTICE', text: `${line}\n`, root, htmlUrl: '' });
    assert.deepEqual(relationships(result.observations), [{ type: expected, target: 'a/b' }], `line: ${line}`);
  }
});

test('an attribution phrase with no repository URL produces no relationship at all', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'This design is inspired by the way early command line tools behaved.\n',
    root,
    htmlUrl: '',
  });
  assert.equal(result.observations.length, 0);
  assert.equal(result.diagnostics[0]?.code, 'attribution_phrase_without_repository_url');
});

test('a phrase separated from its URL by a blank line is not a declaration', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'Inspired by the original paper.\n\nSee https://github.com/a/b for details.\n',
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'references', target: 'a/b' }]);
});

test('a declaration that wraps across lines is recorded as a line range', () => {
  const result = scanDocument({
    path: 'README.md',
    text: ['Inspired by [Ada Lovelace](https://github.com/a/b)', "and the notes in that repository.", ''].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'declared_inspiration', target: 'a/b' }]);
  assert.equal(result.observations[0]?.evidence.locator?.lineStart, 1);
  assert.equal(result.observations[0]?.evidence.locator?.lineEnd, 1);
});

test('a phrase with a URL two lines later is still a declaration, and the range is kept', () => {
  const result = scanDocument({
    path: 'README.md',
    text: ['Inspired by [Romain', "Courtois](https://github.com/a/b)'s work.", ''].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'declared_inspiration', target: 'a/b' }]);
  const evidence = result.observations[0]!.evidence;
  assert.equal(evidence.locator?.lineStart, 1);
  assert.equal(evidence.locator?.lineEnd, 2);
  assert.equal(evidence.data.line_end, 2);
  assert.match(String(evidence.observedText), /Romain/);
  assert.match(String(evidence.observedText), /Courtois/);
});

test('the attribution window does not reach past a blank line', () => {
  const result = scanDocument({
    path: 'README.md',
    text: ['Port of the original tool.', '', 'See https://github.com/a/b.', ''].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'references', target: 'a/b' }]);
  assert.equal(result.diagnostics[0]?.code, 'attribution_phrase_without_repository_url');
});

test('a user profile link is not a repository relationship', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'Inspired by [someone](https://github.com/someone) whose project is hosted elsewhere.\n',
    root,
    htmlUrl: '',
  });
  assert.equal(result.observations.length, 0);
});

test('phrases inside fenced or indented code blocks are ignored', () => {
  const fenced = scanDocument({
    path: 'README.md',
    text: ['```bash', '# install with --based-on option', 'git clone https://github.com/a/b', '```', ''].join('\n'),
    root,
    htmlUrl: '',
  });
  const indented = scanDocument({
    path: 'README.md',
    text: ['Installation', '', '    derived from https://github.com/a/b', ''].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.equal(fenced.observations.length, 0, 'links inside a code fence are not treated as project references');
  assert.equal(indented.observations.length, 0);
});

test('a URL receives one relationship at the strongest declared meaning', () => {
  const result = scanDocument({
    path: 'README.md',
    text: ['See https://github.com/a/b for the background.', 'This tool is inspired by https://github.com/a/b.', ''].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'declared_inspiration', target: 'a/b' }]);
});

test('self references are never emitted', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'Inspired by our own https://github.com/me/myproject design.\n',
    root,
    htmlUrl: '',
  });
  assert.equal(result.observations.length, 0);
});

test('non-GitHub hosts are ignored', () => {
  const result = scanDocument({
    path: 'LICENSE',
    text: [
      'Licensed under Apache 2.0, https://www.apache.org/licenses/LICENSE-2.0',
      'Inspired by https://gitlab.com/a/b and https://bitbucket.org/c/d',
      '',
    ].join('\n'),
    root,
    htmlUrl: '',
  });
  assert.equal(result.observations.length, 0);
});

test('markdown link syntax and trailing punctuation do not break extraction', () => {
  const result = scanDocument({
    path: 'README.md',
    text: 'This is [inspired by](https://github.com/a/b), with thanks.\n',
    root,
    htmlUrl: '',
  });
  assert.deepEqual(relationships(result.observations), [{ type: 'declared_inspiration', target: 'a/b' }]);
});

test('oversized documents are truncated before scanning', () => {
  const padding = 'x'.repeat(300_000);
  const result = scanDocument({
    path: 'README.md',
    text: `padding ${padding}\nInspired by https://github.com/a/b\n`,
    root,
    htmlUrl: '',
  });
  assert.equal(result.observations.length, 0);
});

test('document selection covers the attribution-bearing files only', () => {
  const selected = ['README.md', 'readme.rst', 'NOTICE', 'ACKNOWLEDGEMENTS.md', 'CREDITS', 'LICENSE', 'docs/architecture.md', 'src/index.ts', 'package.json'];
  const expected = [true, true, true, true, true, true, true, false, false];
  selected.forEach((path, index) => {
    assert.equal(isScannableDocument(path), expected[index], `path: ${path}`);
  });
});
