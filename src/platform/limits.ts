/**
 * Central numeric boundaries for every untrusted input path.
 *
 * Everything here is a hard cap, not a suggestion: collectors must degrade
 * (emit partial results plus a diagnostic) instead of exceeding a limit.
 */

export const LIMITS = {
  http: {
    timeoutMs: 20_000,
    maxResponseBytes: 8_388_608,
    maxRedirects: 0,
    maxRetries: 2,
    /**
     * The longest upstream rate-limit wait worth sitting through. A secondary
     * limit clears in seconds and is worth waiting for; a primary limit resets
     * on the hour and is not, because the analysis would time out long before
     * it resumed and would then be reported as a timeout rather than as the rate
     * limit it actually was.
     */
    maxRateLimitWaitMs: 5_000,
  },
  repository: {
    maxFullNameLength: 120,
    maxOwnerLength: 40,
    maxNameLength: 100,
  },
  document: {
    maxBytes: 262_144,
    maxFiles: 40,
    maxLineLength: 4_000,
    /** How many lines around a phrase still count as the same declaration. */
    attributionWindowLines: 2,
    maxUrlMatchesPerFile: 200,
    /**
     * `references` is the weakest relationship type. A README link list must
     * not be able to bury the lineage edges, so the number of reference
     * relationships per analysis is bounded and the cap is reported.
     */
    maxReferenceRelationships: 40,
  },
  manifest: {
    maxBytes: 2_097_152,
    maxDependencies: 400,
  },
  submodule: {
    maxEntries: 200,
    maxBytes: 131_072,
  },
  tree: {
    maxEntries: 120_000,
    maxBlobPairsCompared: 8_000,
    maxBlobEvidenceRecords: 25,
    maxSharedBlobSamples: 25,
  },
  history: {
    maxDepth: 200,
    maxSharedCommitSamples: 25,
  },
  candidates: {
    /** Upper bound on how many candidate repositories are fetched and analysed. */
    maxRepositories: 12,
    maxBlobComparisons: 12,
  },
  registry: {
    maxLookups: 25,
    maxBytes: 262_144,
  },
  graph: {
    maxEntities: 2_000,
    maxRelationships: 5_000,
    maxEvidence: 20_000,
  },
} as const;

export type LimitProfile = typeof LIMITS;
