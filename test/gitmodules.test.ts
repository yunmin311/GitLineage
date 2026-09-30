import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitmodules } from '../src/platform/git.ts';

test('parses a normal .gitmodules file', async () => {
  const content = [
    '[submodule "vendor/lib"]',
    '\tpath = vendor/lib',
    '\turl = https://github.com/foo/bar.git',
    '\tbranch = main',
    '[submodule "docs"]',
    '\tpath = docs',
    '\turl = git@github.com:baz/qux.git',
    '',
  ].join('\n');
  const entries = await parseGitmodules(content);
  assert.deepEqual(entries, [
    { name: 'docs', path: 'docs', url: 'git@github.com:baz/qux.git' },
    { name: 'vendor/lib', path: 'vendor/lib', url: 'https://github.com/foo/bar.git', branch: 'main' },
  ]);
});

test('keeps submodule names that contain dots and slashes', async () => {
  const content = [
    '[submodule "third_party/googletest"]',
    '\tpath = third_party/googletest',
    '\turl = https://github.com/google/googletest.git',
    '',
  ].join('\n');
  const entries = await parseGitmodules(content);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, 'third_party/googletest');
  assert.equal(entries[0]?.path, 'third_party/googletest');
});

test('drops entries without both a path and a url', async () => {
  const content = ['[submodule "broken"]', '\tpath = only-path', '', '[submodule "empty"]', '\turl = https://github.com/a/b', ''].join('\n');
  assert.deepEqual(await parseGitmodules(content), []);
});

test('rejects paths that try to escape the repository', async () => {
  const content = [
    '[submodule "escape"]',
    '\tpath = ../../etc',
    '\turl = https://github.com/a/b',
    '[submodule "absolute"]',
    '\tpath = /etc/passwd',
    '\turl = https://github.com/a/b',
    '',
  ].join('\n');
  assert.deepEqual(await parseGitmodules(content), []);
});

test('a hostile .gitmodules file cannot inject options or extra entries', async () => {
  const content = [
    '[submodule "a"]',
    '\tpath = a',
    '\turl = https://github.com/real/repo',
    '[submodule "b"]',
    '\turl = --upload-pack=touch',
    '\tpath = b',
    '',
  ].join('\n');
  const entries = await parseGitmodules(content);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.url),
    ['https://github.com/real/repo', '--upload-pack=touch'],
  );
});

test('only git with an allowlisted subcommand can be spawned', async () => {
  const { ALLOWED_GIT_SUBCOMMANDS, runGit } = await import('../src/platform/git.ts');
  assert.equal(ALLOWED_GIT_SUBCOMMANDS.has('clone'), false);
  assert.equal(ALLOWED_GIT_SUBCOMMANDS.has('fetch'), true);
  await assert.rejects(() => runGit(['clone', 'https://github.com/a/b', 'x']));
  await assert.rejects(() => runGit(['push']));
  await assert.rejects(() => runGit(['config', '--global', 'core.sshCommand', 'evil']));
  await assert.rejects(() => runGit(['config', '--system', 'core.sshCommand', 'evil']));
  await assert.rejects(() => runGit(['config', '--file', 'somewhere', 'a', 'b']));
  await assert.rejects(() => runGit(['fetch', '--upload-pack=touch', 'origin']));
  await assert.rejects(() => runGit(['-c', 'core.sshCommand=evil', 'fetch']));
});
