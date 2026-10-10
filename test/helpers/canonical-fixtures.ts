import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildView, type ViewGraph } from '../../src/web/view-model.ts';

const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures', 'canonical');

export type CanonicalFixtureName =
  | 'Kuddev__pebrel'
  | 'grpc__grpc'
  | 'nachocebey__is'
  | 'yunmin311__obsidian-config'
  | 'gitlineage-root'
  | 'mobile-kuddev-pebrel-51514bd'
  | 'mobile-yunmin311-obsidian-config-3982a219'
  | 'mobile-grpc-grpc-724b3ccb';

export function canonicalGraph(name: CanonicalFixtureName): Parameters<typeof buildView>[0] {
  const parsed = JSON.parse(
    readFileSync(resolve(FIXTURES, `${name}.graph.json`), 'utf8'),
  ) as { data?: Parameters<typeof buildView>[0] } | Parameters<typeof buildView>[0];
  if ('data' in parsed && parsed.data) return parsed.data;
  return parsed as Parameters<typeof buildView>[0];
}

export function canonicalView(name: CanonicalFixtureName): ViewGraph {
  return buildView(canonicalGraph(name));
}
