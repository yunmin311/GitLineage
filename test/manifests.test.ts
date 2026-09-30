import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCargoToml,
  parseGoMod,
  parsePackageJson,
  parsePackageLock,
  parsePyproject,
  parseRequirementsTxt,
  parseManifestFile,
  dedupeFacts,
} from '../src/collectors/packages/manifests.ts';

test('package.json runtime and dev dependencies are separated, local specs are skipped', () => {
  const { facts, errors } = parsePackageJson(
    JSON.stringify({
      name: 'demo',
      dependencies: { react: '^19.0.0', 'left-pad': 'file:../left-pad', local: 'link:./local', gitdep: 'git+https://github.com/a/b.git' },
      devDependencies: { typescript: '~5.8.0' },
      peerDependencies: { 'react-dom': '^19.0.0' },
    }),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    facts.map((fact) => `${fact.name}@${fact.range}:${fact.scope}`).sort(),
    ['react-dom@^19.0.0:peer', 'react@^19.0.0:runtime', 'typescript@~5.8.0:dev'].sort(),
  );
});

test('malformed package.json fails safely', () => {
  const { facts, errors } = parsePackageJson('{ "dependencies": ');
  assert.deepEqual(facts, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /invalid JSON/);
});

test('only direct lockfile entries become dependencies, and no credential is carried', () => {
  const { facts } = parsePackageLock(
    JSON.stringify({
      packages: {
        '': { name: 'demo' },
        'node_modules/react': { version: '19.0.0', integrity: 'sha512-aaa', resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz' },
        'node_modules/a/node_modules/b': { version: '1.0.0' },
        'node_modules/dev-only': { version: '2.0.0', dev: true },
        'node_modules/with-token': {
          version: '3.0.0',
          resolved: 'https://user:ghp_secret@registry.npmjs.org/with-token/-/with-token-3.0.0.tgz',
        },
      },
    }),
  );
  assert.deepEqual(
    facts.map((fact) => fact.name).sort(),
    ['react', 'with-token'],
  );
  assert.equal(
    JSON.stringify(facts).includes('ghp_secret'),
    false,
    'credentials in a lockfile resolved URL must never reach the graph',
  );
});

test('pyproject PEP 508 dependencies are parsed, markers stripped', () => {
  const { facts } = parsePyproject(
    [
      '[project]',
      'name = "demo"',
      'dependencies = [',
      '  "requests>=2.31",',
      '  "httpx[cli] == 0.27.0 ; python_version >= \'3.9\'",',
      '  "not a spec",',
      ']',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    facts.map((fact) => `${fact.name}|${fact.range}|${fact.scope}`),
    ['httpx|== 0.27.0|runtime', 'requests|>=2.31|runtime'],
  );
});

test('poetry dependency tables are read, path dependencies are skipped', () => {
  const { facts } = parsePyproject(
    [
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'rich = "^13.0"',
      'internal = { path = "../internal" }',
      'fromgit = { git = "https://github.com/a/b.git" }',
      '[tool.poetry.dev-dependencies]',
      'pytest = "^8.0"',
      '',
    ].join('\n'),
  );
  const rich = facts.find((fact) => fact.name === 'rich');
  assert.equal(rich?.range, '^13.0');
  assert.equal(rich?.scope, 'runtime');
  assert.equal(facts.some((fact) => fact.name === 'internal'), false);
  assert.equal(facts.find((fact) => fact.name === 'fromgit')?.sourceUrlHint, 'https://github.com/a/b.git');
  assert.equal(facts.find((fact) => fact.name === 'pytest')?.scope, 'dev');
});

test('requirements.txt skips includes, comments, URLs and editable paths', () => {
  const { facts } = parseRequirementsTxt(
    [
      '# comment',
      '-r other.txt',
      '--index-url https://example.com',
      'requests==2.31.0',
      'urllib3>=1.26  # pinned by security review',
      'flask[async]==3.0.0 ; python_version >= "3.8"',
      './local',
      'https://example.com/pkg.tar.gz',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    facts.map((fact) => `${fact.name}|${fact.range}`),
    ['flask|==3.0.0', 'requests|==2.31.0', 'urllib3|>=1.26'],
  );
});

test('Cargo.toml reads version, git and skips path dependencies', () => {
  const { facts } = parseCargoToml(
    [
      '[package]',
      'name = "demo"',
      '[dependencies]',
      'serde = "1.0"',
      'rand = { version = "0.8" }',
      'fromgit = { git = "https://github.com/rust-random/rand" }',
      'local = { path = "../local" }',
      '[dev-dependencies]',
      'tempfile = "3.0"',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    facts.map((fact) => `${fact.name}|${fact.range}|${fact.scope}`),
    ['fromgit|*|runtime', 'rand|0.8|runtime', 'serde|1.0|runtime', 'tempfile|3.0|dev'],
  );
});

test('go.mod single and block requires are both read', () => {
  const { facts } = parseGoMod(
    [
      'module example.com/demo',
      '',
      'go 1.23',
      '',
      'require github.com/spf13/cobra v1.8.1',
      '',
      'require (',
      '\tgolang.org/x/sys v0.28.0 // indirect',
      '\tgithub.com/gin-gonic/gin v1.10.0',
      ')',
      '',
      'replace example.com/local => ./local',
      '',
    ].join('\n'),
  );
  assert.deepEqual(
    facts.map((fact) => `${fact.name}@${fact.resolvedVersion}`),
    ['github.com/gin-gonic/gin@1.10.0', 'github.com/spf13/cobra@1.8.1', 'golang.org/x/sys@0.28.0'],
  );
});

test('malformed TOML fails safely instead of throwing', () => {
  for (const parse of [parsePyproject, parseCargoToml]) {
    const { facts, errors } = parse('this is not = = toml');
    assert.deepEqual(facts, []);
    assert.equal(errors.length, 1);
  }
});

test('manifest routing is by path and unknown files are ignored', () => {
  assert.ok(parseManifestFile('package.json', '{}'));
  assert.ok(parseManifestFile('sub/package.json', '{}'));
  assert.ok(parseManifestFile('backend/pyproject.toml', ''));
  assert.ok(parseManifestFile('crates/x/Cargo.toml', ''));
  assert.ok(parseManifestFile('go.mod', ''));
  assert.ok(parseManifestFile('requirements-dev.txt', ''));
  assert.equal(parseManifestFile('src/index.ts', ''), null);
  assert.equal(parseManifestFile('README.md', ''), null);
});

test('dedupe keeps manifest and lockfile facts as separate evidence for one package', () => {
  const merged = dedupeFacts([
    { ecosystem: 'npm', name: 'react', range: '^19.0.0', scope: 'runtime', manifestPath: 'package.json', source: 'manifest' },
    { ecosystem: 'npm', name: 'react', range: '19.0.0', resolvedVersion: '19.0.0', integrity: 'sha512-x', scope: 'runtime', manifestPath: 'package.json', source: 'lockfile' },
  ]);
  assert.equal(merged.length, 2, 'manifest declaration and lockfile resolution are different evidence records');
  assert.equal(merged.filter((fact) => fact.source === 'lockfile')[0]?.resolvedVersion, '19.0.0');
});
