/**
 * GitHub URLs that are not repositories.
 *
 * Reproduced from the real graph of yunmin311/obsidian-config, which contained:
 *
 *   repo:github:settings/profile     type Repository   no URL
 *   repo:github:sponsors/yunmin311   type Repository   no URL
 *
 * A github.com path of exactly `owner/name` is a repository. A path whose first
 * segment is one of GitHub's own site routes is a page on the site. Nothing in the
 * URL distinguishes the two shapes, so the distinction has to come from GitHub's
 * reserved-route list -- and it has to be a category check, not a blacklist of
 * the two strings that happened to be observed.
 *
 * These tests use real URL shapes, including ones nobody reported, because the
 * point of the fix is the category rather than the two examples.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isGitHubReservedRoute, resolveRepositoryRef, UnsupportedRepositoryRefError } from '../src/platform/url.ts';
import { scanDocument } from '../src/collectors/documents/attribution.ts';
import { refToId } from '../src/core/ids.ts';

const ROOT = { provider: 'github', owner: 'yunmin311', name: 'obsidian-config' } as const;

function scanLinks(...urls: string[]) {
  const text = ['# Project', '', ...urls.map((u) => `See ${u} for details.`)].join('\n');
  return scanDocument({
    path: 'README.md',
    text,
    root: { ...ROOT },
    htmlUrl: 'https://github.com/yunmin311/obsidian-config/blob/main/README.md',
  });
}

// ---------------------------------------------------------------------------
// The parser refuses site routes
// ---------------------------------------------------------------------------

test('a real repository reference still resolves', () => {
  const ref = resolveRepositoryRef('blacksmithgu/obsidian-dataview');
  assert.deepEqual(ref, { provider: 'github', owner: 'blacksmithgu', name: 'obsidian-dataview' });
});

test('GitHub site routes are refused as repository references', () => {
  // The two observed in production, plus unreported ones, because the fix is the
  // category rather than the examples.
  for (const input of [
    'settings/profile',
    'sponsors/yunmin311',
    'sponsors/sindresorhus',
    'topics/gitignore',
    'features/copilot',
    'orgs/github',
    'collections/machine-learning',
    'notifications',
  ]) {
    assert.throws(
      () => resolveRepositoryRef(input),
      UnsupportedRepositoryRefError,
      `${input} must not resolve as a repository`,
    );
  }
});

test('a full site-route URL is refused too, not just the bare owner/name form', () => {
  assert.throws(
    () => resolveRepositoryRef('https://github.com/settings/profile'),
    UnsupportedRepositoryRefError,
  );
});

test('isGitHubReservedRoute is case-insensitive and reports the category', () => {
  assert.equal(isGitHubReservedRoute('settings'), true);
  assert.equal(isGitHubReservedRoute('SETTINGS'), true);
  assert.equal(isGitHubReservedRoute('  Sponsors '), true);
  // Real accounts are not site routes, including ones that look route-ish.
  assert.equal(isGitHubReservedRoute('sindresorhus'), false);
  assert.equal(isGitHubReservedRoute('settings'), true);
  assert.equal(isGitHubReservedRoute('oss'), false);
  assert.equal(isGitHubReservedRoute('settings-config'), false);
  assert.equal(isGitHubReservedRoute('sponsor'), false);
});

// ---------------------------------------------------------------------------
// The classifier emits ExternalProject, and keeps the relationship and evidence
// ---------------------------------------------------------------------------

test('a site route in prose becomes an ExternalProject, not a Repository', () => {
  const result = scanLinks('https://github.com/settings/profile', 'https://github.com/sponsors/yunmin311');
  const objects = result.observations.map((o) => o.object);

  for (const object of objects) {
    assert.equal(object.kind, 'external_project', `expected external_project, got ${object.kind}`);
  }
  const kinds = new Set(objects.map((o) => o.kind));
  assert.equal(kinds.size, 1);
  assert.equal(kinds.has('repository' as never), false, 'no Repository entity for a site route');
});

test('the references relationship is preserved, with its evidence', () => {
  const result = scanLinks('https://github.com/settings/profile');
  assert.equal(result.observations.length, 1, 'the link is still recorded');
  const [observation] = result.observations;
  assert.equal(observation?.relationship, 'references', 'not dropped, and not upgraded to a claim');
  assert.equal(observation?.directed, true);
  assert.equal(observation?.subject.kind, 'repository');
  assert.equal(observation?.subject.kind === 'repository' && observation.subject.owner, 'yunmin311');
  // The evidence survives intact, including where it was seen.
  const evidence = observation?.evidence;
  assert.equal(evidence?.type, 'document_reference');
  assert.equal(evidence?.status, 'DECLARED');
  const data = (evidence?.data ?? {}) as Record<string, unknown>;
  assert.match(String(data.path), /README\.md/);
  assert.equal(typeof data.line_start, 'number');
  assert.match(String(data.matched_text), /settings\/profile/);
});

test('the ExternalProject entity id is stable and derived from the path', () => {
  const expected = refToId({ kind: 'external_project', slug: 'settings/profile' });
  const result = scanLinks('https://github.com/settings/profile');
  assert.equal(result.observations[0]?.object.kind === 'external_project'
    ? refToId(result.observations[0].object)
    : '', expected);
});

test('real repositories are still repositories', () => {
  const result = scanLinks(
    'https://github.com/blacksmithgu/obsidian-dataview',
    'https://github.com/scambier/obsidian-omnisearch',
  );
  assert.equal(result.observations.length, 2);
  for (const observation of result.observations) {
    assert.equal(observation.object.kind, 'repository');
    assert.equal(observation.object.kind === 'repository' && observation.object.provider, 'github');
  }
});

test('a repository and a site route in the same document are classified apart', () => {
  const result = scanLinks(
    'https://github.com/blacksmithgu/obsidian-dataview',
    'https://github.com/settings/profile',
    'https://github.com/sponsors/yunmin311',
  );
  assert.equal(result.observations.length, 3, 'all three links are kept');
  const byKind = result.observations.map((o) => o.object.kind).sort();
  assert.deepEqual(byKind, ['external_project', 'external_project', 'repository']);
});

test('a self-link is still ignored', () => {
  const result = scanLinks('https://github.com/yunmin311/obsidian-config');
  assert.equal(result.observations.length, 0, 'the root repository is not referenced by itself');
});

test('no site route produces an entity id under the repository namespace', () => {
  // The production symptom was literally this: repo:github:settings/profile.
  const result = scanLinks(
    'https://github.com/settings/profile',
    'https://github.com/sponsors/yunmin311',
    'https://github.com/topics/gitignore',
    'https://github.com/collections/machine-learning',
  );
  const ids = result.observations.map((o) => refToId(o.object));
  for (const id of ids) {
    assert.ok(!id.startsWith('repo:'), `${id} must not be a repository id`);
    assert.ok(id.startsWith('project:'), `${id} should be an external project id`);
  }
});