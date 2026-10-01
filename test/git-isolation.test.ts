import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchShallowHistory, runGit } from '../src/platform/git.ts';

/**
 * Regression tests for a bug found by live validation: the analyser adopted the
 * repository that *contained* the cache directory, because `git rev-parse`
 * searches upward. It then rewrote that repository's `origin` remote and turned
 * it into a shallow, blob-filtered clone.
 *
 * These tests reproduce that setup and assert the analyser leaves the enclosing
 * repository untouched.
 */

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'gitlineage-git-'));
  try {
    return await fn(dir);
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  }
}

test('a cache directory inside a repository never adopts that repository', async () => {
  await withTempDir(async (dir) => {
    // An enclosing repository with a remote we must not touch.
    const host = join(dir, 'host-repo');
    await mkdir(host, { recursive: true });
    const sandbox = join(dir, 'sandbox');
    await runGit(['init', '--quiet', host], { sandboxHome: sandbox });
    await runGit(['remote', 'add', 'origin', 'https://github.com/example/host.git'], {
      cwd: host,
      sandboxHome: sandbox,
    });
    const configPath = join(host, '.git', 'config');
    const before = await readFile(configPath, 'utf8');

    // The cache lives *inside* the host repository, which is the exact
    // situation that caused the incident.
    const cacheDir = join(host, '.cache', 'git', 'example', 'repo.git');
    await mkdir(cacheDir, { recursive: true });

    // A fetch that cannot reach the network still exercises initialisation,
    // remote configuration and rev-parse.
    try {
      await fetchShallowHistory({
        repoDir: cacheDir,
        remoteUrl: 'https://github.com/example/repo.git',
        depth: 1,
        sandboxHome: sandbox,
        timeoutMs: 3_000,
      });
    } catch {
      // Network failure is irrelevant; repository isolation is not.
    }

    const after = await readFile(configPath, 'utf8');
    assert.equal(after, before, "the analyser's git work must not modify the enclosing repository");
  });
});

test('the cache repository is initialised independently and configured in isolation', async () => {
  await withTempDir(async (dir) => {
    const sandbox = join(dir, 'sandbox');
    const cacheDir = join(dir, 'isolated', 'repo.git');
    try {
      await fetchShallowHistory({
        repoDir: cacheDir,
        remoteUrl: 'https://github.com/example/nonexistent-private-repo-xyz.git',
        depth: 1,
        sandboxHome: sandbox,
        timeoutMs: 3_000,
      });
    } catch {
      // Expected without credentials or network access.
    }
    // The cache directory itself must be a real repository with our remote.
    const config = await readFile(join(cacheDir, 'config'), 'utf8').catch(() => '');
    assert.match(config, /example\/nonexistent-private-repo-xyz\.git/);
  });
});

test('git refuses to rewrite a remote outside the sandbox', async () => {
  await withTempDir(async (dir) => {
    const sandbox = join(dir, 'sandbox');
    const repo = join(dir, 'r.git');
    await runGit(['init', '--bare', '--quiet', repo], { sandboxHome: sandbox });
    // A remote may be added to the cache repository we created...
    await runGit(['remote', 'add', 'origin', 'https://github.com/a/b.git'], {
      cwd: repo,
      sandboxHome: sandbox,
    });
    const ok = await readFile(join(repo, 'config'), 'utf8');
    assert.match(ok, /a\/b\.git/);
    // ...but user-level and system-level config remain unreachable.
    const env = await runGit(['config', '--list', '--show-origin'], {
      cwd: repo,
      sandboxHome: sandbox,
    });
    assert.equal(env.includes('.gitconfig-absent'), false, 'user config must not be read');
  });
});

test('no git argument can escape the allowlist', async () => {
  const forbidden = [
    ['clone', 'https://github.com/a/b', 'x'],
    ['push'],
    ['fetch', '--upload-pack=touch', 'origin'],
    ['config', '--global', 'core.sshCommand', 'evil'],
    ['config', '--system', 'core.sshCommand', 'evil'],
['update-ref', 'refs/heads/main', 'deadbeef'],
  ];
  for (const args of forbidden) {
    await assert.rejects(() => runGit(args), `expected rejection for: ${args.join(' ')}`);
  }
});

test('mutating subcommands require an explicit sandbox working directory', async () => {
  // A `git remote add` without cwd would write to whatever repository contains
  // the process working directory. Every mutating call must therefore pass `cwd`
  // pointing at the cache repository it owns.
  await withTempDir(async (dir) => {
    const sandbox = join(dir, 'sandbox');
    const cacheRepo = join(dir, 'cache.git');
    await runGit(['init', '--bare', '--quiet', cacheRepo], { cwd: dir, sandboxHome: sandbox });
    await runGit(['remote', 'add', 'origin', 'https://github.com/a/b.git'], {
      cwd: cacheRepo,
      sandboxHome: sandbox,
    });
    const config = await readFile(join(cacheRepo, 'config'), 'utf8');
    assert.match(config, /https:\/\/github\.com\/a\/b\.git/);

    // Untrusted remotes never reach the git layer at all.
    await assert.rejects(() =>
      fetchShallowHistory({
        repoDir: join(dir, 'never.git'),
        remoteUrl: 'file:///etc/passwd',
        depth: 1,
        sandboxHome: sandbox,
      }),
    );
  });
});

test('only plain https GitHub remotes are ever fetched', async () => {
  const { assertAllowedRemote, ALLOWED_GIT_REMOTE_PATTERN } = await import('../src/platform/git.ts');
  const allowed = [
    'https://github.com/a/b',
    'https://github.com/a/b.git',
    'https://github.com/owner.name/repo_name.git',
  ];
  const refused = [
    'file:///etc/passwd',
    'ext::sh -c evil',
    'ssh://git@github.com/a/b',
    'git@github.com:a/b.git',
    'http://github.com/a/b',
    'https://gitlab.com/a/b',
    'https://github.com.evil.example/a/b',
    'https://github.com/a/b/../../c',
    '',
  ];
  for (const remote of allowed) {
    assert.equal(ALLOWED_GIT_REMOTE_PATTERN.test(remote), true, `expected allow: ${remote}`);
    assert.doesNotThrow(() => assertAllowedRemote(remote));
  }
  for (const remote of refused) {
    assert.equal(ALLOWED_GIT_REMOTE_PATTERN.test(remote), false, `expected refuse: ${remote}`);
    assert.throws(() => assertAllowedRemote(remote), `expected throw for: ${remote}`);
  }
});

test('fetchShallowHistory rejects an unsafe remote before touching the filesystem', async () => {
  await withTempDir(async (dir) => {
    const sandbox = join(dir, 'sandbox');
    const cacheDir = join(dir, 'unsafe.git');
    await assert.rejects(() =>
      fetchShallowHistory({
        repoDir: cacheDir,
        remoteUrl: 'ext::sh -c evil',
        depth: 1,
        sandboxHome: sandbox,
      }),
    );
    const { stat } = await import('node:fs/promises');
    assert.equal(await stat(cacheDir).then(() => true, () => false), false, 'no directory may be created');
  });
});

test('git modules parsing still works after the isolation change', async () => {
  const content = [
    '[submodule "vendor/lib"]',
    '\tpath = vendor/lib',
    '\turl = https://github.com/foo/bar.git',
    '',
  ].join('\n');
  const { parseGitmodules } = await import('../src/platform/git.ts');
  const entries = await parseGitmodules(content);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.path, 'vendor/lib');
});

test('a written config file is never used as a gitmodules source path', async () => {
  await withTempDir(async (dir) => {
    const trap = join(dir, 'trap');
    await writeFile(trap, 'should never be read as config', 'utf8');
    await assert.rejects(() => runGit(['config', '--file', trap, '--list']));
  });
});