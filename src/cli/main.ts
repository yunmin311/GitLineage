import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { analyze } from '../pipeline/analyze.ts';
import { validateGraph } from '../core/validate.ts';
import type { LineageGraph } from '../core/model.ts';
import { relationshipSpec, RELATIONSHIP_SPECS, EVIDENCE_REQUIRED_DATA_KEYS } from '../core/ontology.ts';
import { EVIDENCE_TYPES, GRAPH_SCHEMA_VERSION } from '../core/model.ts';

const HELP = `gitlineage - evidence-backed repository lineage analyzer

Usage:
  gitlineage analyze <repository> [options]
  gitlineage validate <graph.json>
  gitlineage inspect <graph.json> [relationship-id]
  gitlineage ontology

Arguments:
  repository             owner/name, github.com/owner/name, or a full GitHub URL

Options for analyze:
  --ref <name>           branch, tag or commit to analyse (default: default branch)
  --out <dir>            write graph.json and analysis-metadata.json into <dir>
  --cache <dir>          cache root directory (default: .gitlineage-cache)
  --namespace <name>     cache namespace, public only in V1 (default: public)
  --depth <n>            bounded git history depth (default: 200)
  --max-candidates <n>   candidate repositories to analyse (default: 12)
  --no-git               skip git history and blob analysis
  --no-blobs             skip exact blob comparison
  --no-registry          skip package registry resolution
  --blobs <mode>         lineage-only (default) or all
  --json                 print the graph as JSON on stdout

No repository code is ever executed. No AI service is ever contacted.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ref: { type: 'string' },
      out: { type: 'string' },
      cache: { type: 'string' },
      namespace: { type: 'string' },
      depth: { type: 'string' },
      'max-candidates': { type: 'string' },
      blobs: { type: 'string' },
      'no-git': { type: 'boolean', default: false },
      'no-blobs': { type: 'boolean', default: false },
      'no-registry': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }

  const command = positionals[0]!;

  if (command === 'ontology') {
    process.stdout.write(`${JSON.stringify(ontologyReport(), null, 2)}\n`);
    return 0;
  }

  if (command === 'validate') {
    const file = positionals[1];
    if (!file) throw new Error('validate requires a graph.json path');
    const graph = JSON.parse(await readFile(file, 'utf8')) as LineageGraph;
    const result = validateGraph(graph);
    process.stdout.write(
      result.valid
        ? `valid: ${graph.entities.length} entities, ${graph.relationships.length} relationships, ${graph.evidence.length} evidence records\n`
        : `${result.errors.map((error) => `error: ${error}`).join('\n')}\n`,
    );
    return result.valid ? 0 : 1;
  }

  if (command === 'inspect') {
    const file = positionals[1];
    if (!file) throw new Error('inspect requires a graph.json path');
    const graph = JSON.parse(await readFile(file, 'utf8')) as LineageGraph;
    const validation = validateGraph(graph);
    if (!validation.valid) {
      process.stderr.write(`graph is invalid:\n${validation.errors.join('\n')}\n`);
      return 1;
    }
    process.stdout.write(renderInspection(graph, positionals[2]));
    return 0;
  }

  if (command !== 'analyze') {
    process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
    return 2;
  }

  const target = positionals[1];
  if (!target) throw new Error('analyze requires a repository reference');

  const cacheRoot = resolve(values.cache ?? '.gitlineage-cache');
  const result = await analyze({
    target,
    ref: values.ref,
    cacheRoot,
    namespace: (values.namespace as 'public' | 'private' | undefined) ?? 'public',
    outDir: values.out ? resolve(values.out) : undefined,
    depth: values.depth ? Number(values.depth) : undefined,
    maxCandidates: values['max-candidates'] ? Number(values['max-candidates']) : undefined,
    enableGit: !values['no-git'],
    enableBlobs: !values['no-blobs'],
    enableRegistry: !values['no-registry'],
    blobComparison: (values.blobs as 'lineage-only' | 'all' | undefined) ?? 'lineage-only',
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result.graph, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderSummary(result.graph, result.candidates, result.artifacts, result.diagnostics.length));
  return 0;
}

function renderSummary(
  graph: LineageGraph,
  candidates: readonly string[],
  artifacts: { graph: string; metadata: string } | null,
  diagnosticCount: number,
): string {
  const lines: string[] = [];
  const root = graph.entities.find((entity) => entity.id === graph.graph.rootEntityId);
  lines.push(`repository   ${root?.display.fullName ?? graph.graph.rootEntityId}`);
  lines.push(`revision     ${graph.graph.revision.commit.slice(0, 12)} (${graph.graph.revision.ref ?? graph.graph.revision.defaultBranch ?? 'HEAD'})`);
  lines.push(`analyzed     ${graph.graph.generatedAt}`);
  lines.push(`entities     ${graph.entities.length}`);
  lines.push(`evidence     ${graph.evidence.length}`);
  lines.push(`diagnostics  ${diagnosticCount}`);
  lines.push('');

  if (graph.relationships.length === 0) {
    lines.push('relationships: none could be supported by evidence.');
  } else {
    lines.push('relationships:');
    for (const relationship of graph.relationships) {
      const spec = relationshipSpec(relationship.type);
      const source = graph.entities.find((entity) => entity.id === relationship.source);
      const target = graph.entities.find((entity) => entity.id === relationship.target);
      const arrow = relationship.directed ? '->' : '<->';
      lines.push(
        `  [${relationship.status.padEnd(8)}] ${(source?.display.fullName ?? source?.display.name ?? relationship.source).padEnd(38)} ${arrow} ${(target?.display.fullName ?? target?.display.name ?? relationship.target).padEnd(38)} ${relationship.type}`,
      );
      lines.push(`             evidence: ${relationship.evidenceIds.length} (${relationship.evidenceIds.slice(0, 3).join(', ')}${relationship.evidenceIds.length > 3 ? ', ...' : ''})`);
      lines.push(`             meaning : ${spec.description}`);
    }
  }

  if (candidates.length > 0) {
    lines.push('');
    lines.push('candidates:');
    for (const candidate of candidates) lines.push(`  ${candidate}`);
  }

  const warnings = graph.diagnostics.filter((item) => item.level !== 'info');
  if (warnings.length > 0) {
    lines.push('');
    lines.push('notes:');
    for (const warning of warnings.slice(0, 20)) lines.push(`  ${warning.code}: ${warning.message}`);
  }

  if (artifacts) {
    lines.push('');
    lines.push(`artifacts: ${artifacts.graph}`);
    lines.push(`          ${artifacts.metadata}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderInspection(graph: LineageGraph, relationshipId: string | undefined): string {
  const lines: string[] = [];
  const byId = new Map(graph.evidence.map((evidence) => [evidence.id, evidence]));
  const name = (id: string): string => {
    const entity = graph.entities.find((item) => item.id === id);
    return entity?.display.fullName ?? entity?.display.name ?? id;
  };

  const relationships = relationshipId
    ? graph.relationships.filter((relationship) => relationship.id === relationshipId || relationship.type === relationshipId)
    : graph.relationships;

  if (relationships.length === 0) {
    return 'no matching relationship\n';
  }

  for (const relationship of relationships) {
    lines.push(`relationship ${relationship.id}`);
    lines.push(`  type       ${relationship.type} (${relationship.directed ? 'directed' : 'undirected'})`);
    lines.push(`  source     ${name(relationship.source)}`);
    lines.push(`  target     ${name(relationship.target)}`);
    lines.push(`  status     ${relationship.status}`);
    for (const [key, value] of Object.entries(relationship.attributes).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`  attr.${key} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
    lines.push('  evidence:');
    for (const id of relationship.evidenceIds) {
      const evidence = byId.get(id);
      if (!evidence) continue;
      lines.push(`    - ${evidence.id} [${evidence.status}] ${evidence.type} via ${evidence.collector}/${evidence.extractor}`);
      if (evidence.locator?.path) {
        const range = evidence.locator.lineStart
          ? `${evidence.locator.path}:${evidence.locator.lineStart}${evidence.locator.lineEnd && evidence.locator.lineEnd !== evidence.locator.lineStart ? `-${evidence.locator.lineEnd}` : ''}`
          : evidence.locator.path;
        lines.push(`        location : ${range}`);
      }
      if (evidence.observedText) lines.push(`        observed : ${evidence.observedText}`);
      if (evidence.sourceUrl) lines.push(`        source   : ${evidence.sourceUrl}`);
      for (const [key, value] of Object.entries(evidence.data).sort(([a], [b]) => a.localeCompare(b))) {
        if (key === 'relationship_semantics') {
          lines.push(`        note     : ${String(value)}`);
          continue;
        }
        const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
        lines.push(`        ${key.padEnd(10)}: ${rendered.length > 300 ? `${rendered.slice(0, 300)}...` : rendered}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function ontologyReport(): unknown {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    relationshipTypes: RELATIONSHIP_SPECS.map((spec) => ({
      type: spec.type,
      directed: spec.directed,
      allowedStatuses: spec.allowedStatuses,
      allowedEvidenceTypes: spec.allowedEvidenceTypes,
      description: spec.description,
    })),
    evidenceTypes: EVIDENCE_TYPES.map((type) => ({ type, requiredDataKeys: EVIDENCE_REQUIRED_DATA_KEYS[type] })),
  };
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
