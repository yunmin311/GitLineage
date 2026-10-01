# Web slice — Phase 1

A thin HTTP boundary over the analyzer, a separate presentation layer, and the
R3.1 subject-centric one-hop Explorer rendered from real analyzer output.

The core provenance contract is **frozen**. This phase changed no ontology,
collector, evidence semantic, resolver behaviour or graph schema field to make
the UI easier. Every visual problem found in real data was fixed in the
presentation and layout layer, and the deviations are listed at the end.

## Running it

```bash
npm run serve                      # http://127.0.0.1:4317
open http://127.0.0.1:4317/nachocebey/is
npm run serve:api-only             # API without the client bundle

node test/web/live-web-validation.ts   # live checks against real repositories
node test/web/screenshots.ts           # headless capture into docs/screenshots
```

## Data flow

```
/owner/repo  (client route)
      │
      ├── GET /api/graph/<owner>/<repo>   → canonical LineageGraph, UNCHANGED
      └── GET /api/view/<owner>/<repo>    → presentation view-model
                                                │
                                                ▼
                                          buildView(graph)
                                                │
                                                ▼
                                    layout / labels / visibility / counts
                                                │
                                                ▼
                                          R3.1 SVG renderer
                                                │
                                          click edge → Evidence Drawer
```

The canonical graph is the source of truth. The view-model is derived from it
and adds no field back into it. `test/view-model.test.ts` asserts this by
comparing the graph's JSON before and after `buildView`.

## API

### `GET /api/graph/<owner>/<repo>`

Returns the canonical `LineageGraph` **byte-for-byte as the analyzer produced
it**. No view fields, no renaming, no wrapper inside `data`.

```json
{
  "ok": true,
  "data": { "schemaVersion": "2.0.0", "graph": {...}, "entities": [...],
            "relationships": [...], "evidence": [...], "diagnostics": [...] },
  "meta": { "endpoint": "canonical-graph", "note": "canonical LineageGraph, unmodified" }
}
```

Before serving, the graph is re-validated. A graph that fails its own contract
returns `500 contract_violation` rather than being published, and a graph at an
unsupported `schemaVersion` is refused the same way.

### `GET /api/view/<owner>/<repo>`

Returns the presentation view-model derived from the same graph.

| Field | Meaning |
| --- | --- |
| `subject`, `nodes[]` | nodes with `slot`, `label`, `fact`, `isSubject`, `isPackage` |
| `edges[]` | `directed`, `arrow`, `arrowheadAt`, `family`, `label`, `subjectRole`, `visibility`, `evidenceCount` |
| `primaryEdgeCount` / `bundledEdgeCount` / `bundles[]` | density handling, with real counts |
| `statusCounts`, `familyCounts` | evidence-status and relation-family totals |
| `directionContract` | `directional[]` and `symmetric[]`, straight from the ontology |
| `evidenceByRelationship{}` | the real `Evidence` records, for the drawer |
| `empty{}`, `partial{}` | terminal states |

### `GET /api/contract`

Publishes `graphSchemaVersion`, `supportedGraphSchemaVersions`,
`analyzerVersion` and the direction contract, so a client never has to hard-code
them.

### `GET /healthz`

Status plus schema and analyzer versions.

Errors use one envelope shape: `{ ok: false, error: { code, message, detail } }`
with `400` for an unusable repository reference, `502` when analysis fails, and
`500` for a contract violation.

## Canonical graph → view-model

| Canonical | View-model | Why |
| --- | --- | --- |
| `relationship.directed` | `edge.directed`, `edge.arrow`, `edge.arrowheadAt` | Copied verbatim. `arrow` is `'none'` for every symmetric type and never carries an `arrowheadAt`. |
| `relationship.type` | `edge.family`, `edge.relationLabel` | Visual grouping only. |
| `relationship.status` | `edge.status`, `statusCounts` | Unchanged. |
| `relationship.source/target` | `edge.source/target`, `subjectRole` | `subjectRole` is `outbound`/`inbound`/`peer` and affects **wording only**. |
| — | `node.slot` | Derived from the *semantics* of the connecting edge: provenance arriving at the subject sits above, a symmetric peer has no vertical slot. |
| `evidenceIds` | `evidenceCount`, `evidenceByRelationship[edgeId]` | The real records, locator and observed text intact. |
| `relationships` | `visibility`, `bundles[]` | Density handling. Nothing is dropped. |

Two rules are enforced by tests rather than convention:

1. **Arrow direction comes from the relationship.** The renderer branches only on
   `'end'` vs `'end-weak'`. There is no code path in `app.js` that reads the
   selected node to decide direction.
2. **Symmetric endpoint order is a storage detail.** Focusing either endpoint
   re-draws the same edges with the same arrows; only dimming changes.

## Route behaviour

`/<owner>/<repo>` is the primary route, so replacing the domain later is a DNS
change with no routing work. The client parses the path itself and works as a
plain file too. `parseRoute` accepts exactly two segments, validates the owner
and name, and rejects everything else with `404`.

Selection state lives in the query string (`?edge=&node=&depth=`), so a
specific view is shareable and survives reload. `Esc` clears it.

## Screenshots

Real repositories, real analyzer output, headless Chromium at 1600×1000.

| File | Case |
| --- | --- |
| `01-fork-shared-history-exact-content.png` | `nachocebey/is`: one arrowhead for the directional fork, none for the two symmetric edges |
| `01-…-evidence-drawer.png` | Drawer showing the real `github_fork_metadata` record |
| `02-declared-attribution-bundled.png` | `vitest-dev/vitest`: declared fork from a README, 101 secondary edges bundled |
| `02-…-evidence-drawer.png` | Drawer showing `document_attribution` at `docs/blog/vitest-5.md:338` with the verbatim line |
| `03-empty-strong-lineage.png` | `octocat/Spoon-Knife`: no evidence-backed lineage |

## Where real data forced a deviation from R3.1

Three, all handled in the presentation layer.

**1. One hop is not seven edges.** R3.1 assumes roughly seven relationships.
`vitest-dev/vitest` produces 102 one-hop relationships, 83 of them
`depends_on` from 24 manifest files. Drawing them would bury the single
declared fork that is the actual answer.

Resolution: the view-model marks edges `primary` or `bundled`. Lineage-bearing
types are drawn up to `PRIMARY_DRAW_CAP = 30`; the remainder, plus all
`depends_on` and `references`, collapse into bundles that show a real count and
expand on click. The header states `1 shown / 102 one-hop / 102 relationships`
and the bundle panel explains what was grouped. `grpc/grpc` keeps its 25
lineage edges drawn, because they *are* that repository's story.

**2. Several relationships can join the same pair of repositories.** A fork also
shares history and identical content with its upstream, so three edges connect
the same two nodes. R3.1's sample has one edge per pair.

Resolution: parallel edges are bowed apart by a perpendicular offset, and each
label is anchored at a different position along its own curve. Without this the
three labels overprinted into unreadable text and two edges were invisible
underneath the third.

**3. Slot assignment is not sufficient for a repository with several roles.**
`nachocebey/is` is simultaneously a fork source, a history peer and an identity
peer of `sindresorhus/is`. The slot rule resolves ancestry first, so all three
edges meet at the `downstream` slot.

Resolution: no semantic compromise was made. The slot stays `downstream`, which
is correct for the directional edge, and the symmetric edges are drawn to the
same node without arrows, so they cannot be misread as direction.

## Not built, deliberately

No dashboard, no workspace, no auth, no project manager, no search index, no
timeline. No repository code is executed: the server calls the same analyzer the
CLI does, over the same allowlisted HTTP client and the same bounded git runner.