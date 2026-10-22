# Frozen Discovery V4 evaluation inputs

`public-corpus.json` retains purpose labels, actual public metadata, source revision,
Git blob, SHA-256 and acquisition receipts. Source `.js` files are data: tests parse
or fingerprint them but never import or execute them. Corresponding `.LICENSE` files
retain the upstream notices. The snapshot was acquired on 2026-10-22 with the explicit
`experiments/discovery-v4/acquire.py` utility. Re-acquisition changes the snapshot;
normal benchmark replay reads only these frozen files and uses no network.

Candidate labels concern repository purpose, not ancestry. Source positives are
constructed preserved implementations or the observed public fork example; negatives
mean no labeled distinctive shared implementation, not proof of independent authorship.
See `docs/discovery-v4.md` for the counterexamples and limitations.

`v3-similarity.ts` is the frozen GitLineage comparison engine at
`01563bc7394a5d900c85f557b3e9867947fabc69`, with only relative imports adjusted.
It provides a real numerical baseline and is never imported by product code.
