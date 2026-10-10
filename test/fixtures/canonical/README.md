# Canonical offline snapshots

These fixed, public-repository Graph Contract 2.0.0 snapshots make the canvas grouping and phone partition tests reproducible in a clean checkout. They contain analyzer output only; tests never execute repository source code or call GitHub.

The four files without a `mobile-` prefix are the exact graph API envelopes used to produce the existing frozen acceptance views. `buildView(snapshot.data)` reproduces those view objects exactly. The three `mobile-` files preserve the separate content-addressed graph objects the phone partition tests previously loaded from `.cache`; their filenames retain the pinned commit prefix used by those tests.

| File | Repository | Pinned commit | Entities | Relationships | Evidence | SHA-256 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `Kuddev__pebrel.graph.json` | `Kuddev/pebrel` | `9dd3d6491bfaaf902a4a3a248c02f36a47abae2d` | 98 | 97 | 137 | `2b3559114f42ca739e19add65193aefecab02d4969d8bf072a68ed4a1a584089` |
| `grpc__grpc.graph.json` | `grpc/grpc` | `724b3ccb608b8ac7e51482a15113edfd94bb28ba` | 43 | 47 | 48 | `302b0309e4b4abb8a110e35d15aaf91a0215d54ebc160ea31ab4f6bece8585d6` |
| `nachocebey__is.graph.json` | `nachocebey/is` | `e9c026c611c1160eaad50da00be4e676b626018f` | 20 | 21 | 39 | `23919dd718443fe90f8ff05902251b8d2e5b1e53e43648ffe7e04a090a45d8a9` |
| `yunmin311__obsidian-config.graph.json` | `yunmin311/obsidian-config` | `3982a219c1027a7128b2dc0d056d211e7f7e5b96` | 15 | 14 | 14 | `f2f6b4c5cd980522f01d26a8fde755d234b9c278bbc618b29a878fa409c6695e` |
| `gitlineage-root.graph.json` | `yunmin311/GitLineage` | `1300ee991bd3eb028e2e716cdef707b9cf98be2d` | 1 | 0 | 0 | `08e0e21c0f37e6c5c5cba7def4a43e283abcfed7f85c15fdc6277cfbabe33a2d` |
| `mobile-kuddev-pebrel-51514bd.graph.json` | `kuddev/pebrel` | `51514bd50094f6d3f417294c9204976e6a19a35a` | 98 | 97 | 137 | `7b182465c71c711938bde5c971206ac41158c511b2e0a7b84514cdf246289edf` |
| `mobile-yunmin311-obsidian-config-3982a219.graph.json` | `yunmin311/obsidian-config` | `3982a219c1027a7128b2dc0d056d211e7f7e5b96` | 15 | 14 | 14 | `c5e8750e6bacb05563c27c068761d3d14a4feb520f1416fd096ee5fd9e8dd253` |
| `mobile-grpc-grpc-724b3ccb.graph.json` | `grpc/grpc` | `724b3ccb608b8ac7e51482a15113edfd94bb28ba` | 43 | 47 | 48 | `b8d926f3aea5590bc8ad1c1191c1a25be7a92e77882baf1b666fee4768115c2e` |

To refresh a snapshot, update the pinned revision and digest here and review the affected behavioral assertions. Do not regenerate these files as a side effect of browser or network tests.
