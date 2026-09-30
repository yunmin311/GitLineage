# Security boundaries

The analyser reads untrusted, attacker-controlled data from public
repositories. The boundaries below are implemented, not aspirational.

## Never execute repository code

The only process GitLineage ever spawns is `git`, and only for:

```
init, remote, fetch, rev-list, config, cat-file, rev-parse
```

Enforcement:

- `execFile` with a fixed argument vector. No shell, no string command, no
  interpolation of repository content into a command line.
- Subcommand allowlist (`ALLOWED_GIT_SUBCOMMANDS`); `clone`, `push` and `remote`
  beyond `add`/`set-url` are rejected.
- Argument denylist: `--global`, `--system`, `--exec`, `--upload-pack`,
  `--receive-pack`, `--config-env`, `-c`, `--config`. User config therefore
  cannot inject an `insteadOf` redirect or a `core.sshCommand`.
- `--file` is permitted only as `--file -`, so untrusted `.gitmodules` content
  is parsed from stdin and never from an attacker-chosen path.
- Fetch flags are fixed: `--no-tags --no-recurse-submodules --depth=N
  --filter=blob:none`. No hooks are created or run, and no submodule is
  initialised.
- Environment is scrubbed: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` points
  at a non-existent path, `HOME`/`USERPROFILE` point at a sandbox directory,
  `GIT_TERMINAL_PROMPT=0`, `GIT_ALLOW_PROTOCOL=https` (https only), `LC_ALL=C`.

There is no code path that runs `npm`, `pip`, `cargo`, `make`, `docker`, a test
runner, a repository script or a lifecycle hook. Package metadata is read from
files; it is never obtained by running a package manager.

## SSRF and input resolution

`src/platform/url.ts` is the only way an external reference becomes a URL.

- Repository references accept only `github.com` shapes. Non-GitHub hosts,
  non-https schemes, embedded credentials, non-default ports, `..`, and control
  characters are rejected.
- Every outbound request re-checks the URL against a four-host allowlist:
  `api.github.com`, `raw.githubusercontent.com`, `registry.npmjs.org`,
  `pypi.org`. Private addresses, link-local metadata endpoints, loopback and
  non-default ports cannot be reached.
- Redirects are followed manually, at most three hops, with the allowlist
  re-checked on every hop. This supports renamed and transferred repositories
  without reopening the redirect-based SSRF bypass.
- URLs taken from a response (raw content URLs) are validated before use, not
  trusted because they came from GitHub.

## Resource limits

Every limit lives in `src/platform/limits.ts` and is applied as a hard cap, with
a diagnostic when it bites.

| Area | Limit |
| --- | --- |
| HTTP | 20 s timeout, 8 MiB response cap, 2 retries, 3 redirects |
| Documents | 256 KiB per file, 40 files, 4 000 characters per line, 200 URL matches per file, 40 reference relationships per analysis |
| Manifests | 2 MiB per file, 400 dependency facts |
| `.gitmodules` | 128 KiB, 200 entries, path traversal rejected |
| Tree | 120 000 entries, 8 000 blobs indexed, 25 evidence records per exact-content relationship |
| History | depth 200, 12 candidates, 25 shared commit samples per evidence record |
| Registries | 25 lookups per analysis |
| Git fetch | 120 s, 256 MiB result budget, repository deleted and analysis failed rather than exceeding the budget |
| Graph | 2 000 entities, 5 000 relationships, 20 000 evidence records |

Parsers are linear and iterative; there is no recursive descent over untrusted
structure, and no decompression is performed on repository content.

## Secret handling

- V1 analyses public repositories and works anonymously. A token is optional and
  read from `GITHUB_TOKEN`/`GH_TOKEN` or the local GitHub CLI credential store;
  it is used only as a bearer token for `api.github.com` and is never written to
  an artifact, a log line or a diagnostic.
- Lockfile `resolved` URLs are never copied into the graph, because they can
  embed credentials. Only version and integrity are kept. This is asserted by a
  regression test.
- Submodule remotes may contain credentials in userinfo; they are parsed for
  repository identity only and the raw URL is stored in evidence, so a
  credential-bearing remote would be visible rather than used. Credentials in
  repository references are rejected outright.

## Cache namespace isolation

`<cache-root>/<namespace>/...` with `public` and `private` as separate
directories, and a path-segment validator that rejects separators and `..`.
V1 refuses the `private` namespace with an explicit error before any request or
write, so a future credentialed mode cannot silently reuse public storage. The
refusal is covered by a test that also asserts no storage is created.

## Failure behaviour

- A single unreadable document, unparseable manifest, unreachable candidate or
  truncated tree produces a diagnostic and a partial graph, never a silent claim.
- Before an artifact is written, the produced graph must pass
  `validateGraph`. A contract violation throws instead of publishing a graph
  that would misstate provenance.
- Every dropped relationship has a diagnostic code, so a missing edge is
  explainable rather than invisible.
