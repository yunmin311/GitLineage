import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Cache namespaces are physically separated on disk. A private artifact can
 * therefore never be served from, or written into, the public namespace.
 */
export type CacheNamespace = 'public' | 'private';

export class UnsupportedNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedNamespaceError';
  }
}

function assertSegment(segment: string): string {
  if (segment.length === 0) throw new Error('cache path segment must not be empty');
  if (segment === '.' || segment === '..') throw new Error('illegal cache path segment');
  if (segment.includes('/') || segment.includes('\\') || segment.includes(':')) {
    throw new Error(`illegal characters in cache path segment: ${segment}`);
  }
  return segment;
}

export class Cache {
  readonly root: string;
  readonly namespace: CacheNamespace;

  constructor(root: string, namespace: CacheNamespace = 'public') {
    this.root = root;
    this.namespace = namespace;
  }

  /**
   * V1 analyses public repositories only. Private analysis is refused loudly so
   * that a future credentialed mode cannot silently reuse public storage.
   */
  assertSupported(): void {
    if (this.namespace !== 'public') {
      throw new UnsupportedNamespaceError(
        `cache namespace "${this.namespace}" is not implemented in V1; private repository analysis requires a separate credential and storage design`,
      );
    }
  }

  path(...segments: string[]): string {
    return join(this.root, this.namespace, ...segments.map(assertSegment));
  }

  hashKey(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    const text = await this.readText(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async readBuffer(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  async writeAtomic(path: string, data: string | Buffer): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, path);
  }

  async writeJsonAtomic(path: string, data: unknown): Promise<void> {
    await this.writeAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
  }
}
