/**
 * Reads a persisted job record and reports its server-side timing.
 *
 * The client-side measurement is only a lower bound: polling can be delayed by
 * the tunnel. The persisted record carries the server's own createdAt, startedAt
 * and finishedAt, which is the authoritative duration.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] ?? '/var/tmp/gitlineage-prod/jobs';
const owner = process.argv[3];
const name = process.argv[4];

const files = await readdir(dir);
let record = null;
for (const file of files.filter((f) => f.endsWith('.json'))) {
  const parsed = JSON.parse(await readFile(join(dir, file), 'utf8'));
  if (parsed.owner === owner && parsed.name === name) record = parsed;
}
if (!record) {
  process.stdout.write(`  no record for ${owner}/${name}\n`);
  process.exit(1);
}

const at = (value: string | null): number => (value ? new Date(value).getTime() : 0);
const running = at(record.finishedAt) - at(record.startedAt);
const total = at(record.finishedAt) - at(record.createdAt);

process.stdout.write(`  repository : ${record.owner}/${record.name}\n`);
process.stdout.write(`  phase      : ${record.phase}\n`);
process.stdout.write(`  createdAt  : ${record.createdAt}\n`);
process.stdout.write(`  startedAt  : ${record.startedAt}\n`);
process.stdout.write(`  finishedAt : ${record.finishedAt}\n`);
process.stdout.write(`  revision   : ${record.resolvedRevision}\n`);
process.stdout.write(`  server-measured running time : ${(running / 60000).toFixed(1)} min\n`);
process.stdout.write(`  server-measured total        : ${(total / 60000).toFixed(1)} min\n`);
if (running > 5 * 60_000) {
  process.stdout.write('  PASS: the job ran past five minutes server-side\n');
}