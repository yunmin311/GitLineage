import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';

/**
 * The only process GitLineage ever spawns is `git`, with a fixed argument
 * vector, no shell, a scrubbed environment and a hard allowlist of subcommands.
 *
 * Repository code is never executed: no install, build, test, script, hook or
 * package manager invocation exists anywhere in this codebase.
 */
export const ALLOWED_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'init',
  'remote',
  'fetch',
  'rev-list',
  'config',
  'cat-file',
  'rev-parse',
]);

export class GitError extends Error {
  readonly stderr: string;

  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'GitError';
    this.stderr = stderr;
  }
}

export interface GitLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  maxRepoBytes: number;
}

export const DEFAULT_GIT_LIMITS: GitLimits = {
  timeoutMs: 120_000,
  maxOutputBytes: 8_388_608,
  maxRepoBytes: 268_435_456,
};

export interface RunGitOptions {
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Directory used as HOME so that user-level git config cannot influence fetches. */
  sandboxHome?: string;
  env?: Record<string, string>;
}

function assertSubcommand(subcommand: string): void {
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new GitError(`git subcommand is not allowed: ${subcommand}`, '');
  }
}

function buildEnv(options: RunGitOptions): NodeJS.ProcessEnv {
  const sandboxHome = options.sandboxHome ?? process.cwd();
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    COMSPEC: process.env.COMSPEC ?? '',
    HOME: sandboxHome,
    USERPROFILE: sandboxHome,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(sandboxHome, 'gitconfig-absent'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_ADVICE: '0',
    LC_ALL: 'C',
    ...options.env,
  };
}

/** Argument forms that would let a caller escape the sandbox or run remote code. */
const FORBIDDEN_ARGUMENTS: ReadonlySet<string> = new Set([
  '--global',
  '--system',
  '--exec',
  '--upload-pack',
  '--receive-pack',
  '--config-env',
  '-c',
  '--config',
]);

function assertSafeArguments(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (FORBIDDEN_ARGUMENTS.has(argument)) {
      throw new GitError(`git argument is not allowed: ${argument}`, '');
    }
    const equalsForm = argument.includes('=') ? argument.slice(0, argument.indexOf('=')) : argument;
    if (FORBIDDEN_ARGUMENTS.has(equalsForm)) {
      throw new GitError(`git argument is not allowed: ${argument}`, '');
    }
    // `--file -` is the only permitted file access: untrusted content is parsed
    // through stdin so that no attacker-chosen path is ever opened.
    if (argument === '--file' || argument === '-f' || argument === '--blob') {
      const next = args[index + 1];
      if (next !== '-') throw new GitError(`git ${argument} is restricted to "-" (stdin) inside GitLineage`, '');
      index += 1;
      continue;
    }
    if (argument.startsWith('--file=') && argument !== '--file=-') {
      throw new GitError(`git ${argument} is restricted to "-" (stdin) inside GitLineage`, '');
    }
  }
}

export async function runGit(args: string[], options: RunGitOptions = {}): Promise<string> {
  const [subcommand, ...rest] = args;
  if (!subcommand) throw new GitError('git requires a subcommand', '');
  assertSubcommand(subcommand);
  assertSafeArguments(rest);

  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_GIT_LIMITS.maxOutputBytes;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_LIMITS.timeoutMs;

  return new Promise<string>((resolve, reject) => {
    // Global options must precede the subcommand; the subcommand itself is
    // checked against the allowlist above.
    const child = execFile(
      'git',
      [
        '-c',
        'credential.helper=',
        '-c',
        'protocol.version=2',
        '-c',
        'advice.detachedHead=false',
        ...args,
      ],
      {
        cwd: options.cwd,
        env: buildEnv(options),
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
          reject(
            new GitError(
              killed
                ? `git ${subcommand} timed out after ${timeoutMs}ms`
                : `git ${subcommand} failed: ${error.message}`,
              typeof stderr === 'string' ? stderr.slice(0, 2_000) : '',
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)('git', ['--version'], { timeout: 10_000, windowsHide: true });
    return stdout.includes('git version');
  } catch {
    return false;
  }
}

async function isGitRepository(repoDir: string, sandboxHome: string): Promise<boolean> {
  try {
    const out = await runGit(['rev-parse', '--git-dir'], { cwd: repoDir, sandboxHome });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export interface ShallowHistory {
  commits: string[];
  truncated: boolean;
  head: string;
}

/**
 * Creates or refreshes a bare repository containing only a bounded slice of
 * the remote history: no tags, shallow depth, blobs filtered out.
 */
export async function fetchShallowHistory(options: {
  repoDir: string;
  remoteUrl: string;
  ref?: string | undefined;
  depth: number;
  sandboxHome: string;
  timeoutMs?: number;
}): Promise<ShallowHistory> {
  const { repoDir, remoteUrl, ref, depth, sandboxHome } = options;
  await mkdir(dirname(repoDir), { recursive: true });
  const fresh = await stat(repoDir).then(
    () => false,
    () => true,
  );
  if (fresh) await mkdir(repoDir, { recursive: true });

  const isInitialised = await isGitRepository(repoDir, sandboxHome);
  if (!isInitialised) {
    await runGit(['init', '--bare', '--quiet', repoDir], { sandboxHome });
  }
  const remotes = await runGit(['remote'], { cwd: repoDir, sandboxHome });
  if (!remotes.split('\n').map((line) => line.trim()).includes('origin')) {
    await runGit(['remote', 'add', 'origin', remoteUrl], { cwd: repoDir, sandboxHome });
  } else {
    await runGit(['remote', 'set-url', 'origin', remoteUrl], { cwd: repoDir, sandboxHome });
  }

  const boundedDepth = Math.max(1, Math.min(options.depth, 2_000));
  const fetchArgs = [
    'fetch',
    '--no-tags',
    '--quiet',
    '--no-recurse-submodules',
    `--depth=${boundedDepth}`,
    'origin',
    ...(ref ? [ref] : ['HEAD']),
  ];
  try {
    await runGit([...fetchArgs, '--filter=blob:none'], { cwd: repoDir, sandboxHome, timeoutMs: options.timeoutMs });
  } catch {
    // Servers without partial-clone support still work with a shallow fetch.
    await runGit(fetchArgs, { cwd: repoDir, sandboxHome, timeoutMs: options.timeoutMs });
  }

  const size = await directorySize(repoDir);
  if (size > DEFAULT_GIT_LIMITS.maxRepoBytes) {
    await rm(repoDir, { recursive: true, force: true });
    throw new GitError(
      `bounded fetch produced ${size} bytes which exceeds the ${DEFAULT_GIT_LIMITS.maxRepoBytes} byte budget`,
      '',
    );
  }

  const head = (await runGit(['rev-parse', 'FETCH_HEAD'], { cwd: repoDir, sandboxHome })).trim();
  const requested = Math.min(depth * 5, DEFAULT_GIT_LIMITS.maxOutputBytes);
  const listed = await runGit(['rev-list', '--max-count', String(requested), 'FETCH_HEAD'], {
    cwd: repoDir,
    sandboxHome,
  });
  const commits = listed.split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-f]{40}$/.test(line));

  return { commits, truncated: commits.length >= requested, head };
}

export async function directorySize(path: string): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  let total = 0;
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const info = await stat(full).catch(() => null);
        if (info) total += info.size;
      }
    }
  }
  return total;
}

export interface GitmodulesEntry {
  name: string;
  path: string;
  url: string;
  branch?: string | undefined;
}

const GITMODULES_FIELDS: ReadonlySet<string> = new Set([
  'path',
  'url',
  'branch',
  'update',
  'fetch',
  'ignore',
  'shallow',
  'revision',
]);

/**
 * Parses `.gitmodules` through `git config`, which already implements the
 * quoting and escaping rules of the format. The untrusted file content is fed
 * through stdin, so it never touches a file path of our choosing.
 */
export async function parseGitmodules(content: string, timeoutMs = 15_000): Promise<GitmodulesEntry[]> {
  const out = await runGit(['config', '--file', '-', '--list', '-z'], { stdin: content, timeoutMs });
  const entries = new Map<string, { name: string; path?: string; url?: string; branch?: string }>();

  for (const record of out.split('\0')) {
    if (record.length === 0) continue;
    const separator = record.indexOf('\n');
    if (separator < 0) continue;
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1);
    if (!key.startsWith('submodule.')) continue;
    const remainder = key.slice('submodule.'.length);
    const lastDot = remainder.lastIndexOf('.');
    if (lastDot <= 0) continue;
    const field = remainder.slice(lastDot + 1);
    if (!GITMODULES_FIELDS.has(field)) continue;
    const name = remainder.slice(0, lastDot);
    if (name.length === 0 || name.length > 200) continue;
    const entry = entries.get(name) ?? { name };
    if (field === 'path') entry.path = value;
    else if (field === 'url') entry.url = value;
    else if (field === 'branch') entry.branch = value;
    entries.set(name, entry);
  }

  const result: GitmodulesEntry[] = [];
  for (const entry of entries.values()) {
    if (!entry.path || !entry.url) continue;
    if (entry.path.length > 512 || entry.url.length > 2_048) continue;
    if (entry.path.startsWith('/') || entry.path.includes('..') || entry.path.includes('\\')) continue;
    result.push({
      name: entry.name,
      path: entry.path,
      url: entry.url,
      ...(entry.branch ? { branch: entry.branch } : {}),
    });
  }
  return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function readGitmodulesObjectSize(content: string): Promise<number> {
  return Buffer.byteLength(content, 'utf8');
}
