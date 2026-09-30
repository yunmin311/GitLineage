/**
 * Live integration runner.
 *
 * Live tests read the public GitHub API and perform bounded git fetches, so
 * they are excluded from `npm test` and run explicitly:
 *
 *   npm run test:live
 *
 * Set GITLINEAGE_LIVE=1 to also run them through `node --test`.
 */
process.env.GITLINEAGE_LIVE = '1';

const { spawnSync } = await import('node:child_process');

const result = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=tap', 'test/live/*.test.ts'],
  { stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
