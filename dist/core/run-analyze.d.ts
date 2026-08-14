/**
 * Shared Analysis Orchestrator
 *
 * Extracts the core analysis pipeline from the CLI analyze command into a
 * reusable function that can be called from both the CLI and a server-side
 * worker process.
 *
 * IMPORTANT: This module must NEVER call process.exit(). The caller (CLI
 * wrapper or server worker) is responsible for process lifecycle.
 */
import { type GraphWriteCollapseVerdict } from './index-freshness.js';
import type { KnowledgeGraph } from './graph/types.js';
import { type AnalyzerRunnerIdentity, type RepoMeta } from '../storage/repo-manager.js';
export interface AnalyzeCallbacks {
    onProgress: (phase: string, percent: number, message: string) => void;
    onLog?: (message: string) => void;
}
export interface AnalyzeOptions {
    /**
     * Force a full re-index of the pipeline. Callers may OR this with
     * other flags that imply re-analysis (e.g. `--skills`), so the value
     * here is the PIPELINE-force signal, NOT the registry-collision
     * bypass. See `allowDuplicateName` below.
     */
    force?: boolean;
    /** Repair only search indexes without re-running full parsing/indexing. */
    repairFts?: boolean;
    /** Emit per-index FTS create logs. */
    verbose?: boolean;
    embeddings?: boolean;
    /**
     * Override the auto-skip node-count cap for embedding generation.
     * `undefined` (default) keeps the built-in 50,000-node safety limit;
     * `0` disables the cap entirely; any positive integer sets a custom cap.
     * Mapped from the CLI's `--embeddings [limit]` argument.
     */
    embeddingsNodeLimit?: number;
    /**
     * Explicitly drop any embeddings present in the existing index instead of
     * preserving them. Only meaningful when `embeddings` is false/undefined:
     * the default behavior in that case is to load the previously generated
     * embeddings and re-insert them after the rebuild so a routine
     * re-analyze does not silently wipe a long embedding pass (#issue: analyze
     * silently wipes existing embeddings when run without --embeddings).
     */
    dropEmbeddings?: boolean;
    skipGit?: boolean;
    /** Skip AGENTS.md and CLAUDE.md gitnexus block updates. */
    skipAgentsMd?: boolean;
    /** Omit volatile symbol/relationship counts from AGENTS.md and CLAUDE.md. */
    noStats?: boolean;
    /** Skip installing standard GitNexus skill files directly under .claude/skills/. */
    skipSkills?: boolean;
    /**
     * Build the CFG/PDG substrate (#2081 M1). Forwarded to `PipelineOptions.pdg`,
     * which threads to BOTH the worker (CFG build, via workerData) AND
     * scope-resolution (BasicBlock/CFG emit gate). Off by default.
     */
    pdg?: boolean;
    /** Per-function source-line cap for worker-side CFG construction (#2081 M1).
     *  Forwarded to `PipelineOptions.pdgMaxFunctionLines`. No CLI flag in M1 —
     *  programmatic / server analyze-worker path only; the worker applies
     *  `DEFAULT_PDG_MAX_FUNCTION_LINES` when unset. */
    pdgMaxFunctionLines?: number;
    /** Per-function CFG edge cap. Forwarded to `PipelineOptions.pdgMaxEdgesPerFunction`. */
    pdgMaxEdgesPerFunction?: number;
    /** Per-function REACHING_DEF edge cap (#2082 M2). Forwarded to
     *  `PipelineOptions.pdgMaxReachingDefEdgesPerFunction`. */
    pdgMaxReachingDefEdgesPerFunction?: number;
    /** Per-function CDG edge cap (#2085 M5). Forwarded to
     *  `PipelineOptions.pdgMaxCdgEdgesPerFunction`. No CLI flag or rc key —
     *  programmatic / server path only, like the other pdg caps. */
    pdgMaxCdgEdgesPerFunction?: number;
    /** Per-function taint findings cap (#2083 M3). Forwarded to
     *  `PipelineOptions.pdgMaxTaintFindingsPerFunction`. No CLI flag or rc key
     *  (KTD8) — programmatic / server path only, like the other pdg caps. */
    pdgMaxTaintFindingsPerFunction?: number;
    /** Per-finding taint hop cap (#2083 M3, KTD6). Forwarded to
     *  `PipelineOptions.pdgMaxTaintHops`. No CLI flag or rc key (KTD8). */
    pdgMaxTaintHops?: number;
    /** Per-run cross-function findings/hops/edges caps (#2084 review P1-3).
     *  Forwarded to the matching `PipelineOptions.pdgMaxInterproc*`; resolved
     *  into `RepoMeta.pdg`. No CLI flag or rc key (KTD8). */
    pdgMaxInterprocFindings?: number;
    pdgMaxInterprocHops?: number;
    pdgMaxInterprocEdges?: number;
    /**
     * Stream the BasicBlock + intra-file PDG-edge layer to CSV-on-disk during the
     * emit loop instead of materializing it in the in-memory graph, bounding peak
     * RSS to O(chunk) for full-kernel-scale repos (#2202). Only engages on a full
     * rebuild — `resolveStreamPdgEmit` additionally requires `force === true`
     * (the pre-pipeline guarantee of a full rebuild). May also be enabled via
     * `GITNEXUS_STREAM_PDG_EMIT`. Memory-only; byte-identical output; not stamped
     * into `RepoMeta.pdg`. */
    streamPdgEmit?: boolean;
    /** Streamed PDG-emit write buffer (rows). `undefined` ⇒
     *  `DEFAULT_PDG_EMIT_CHUNK_ROWS`. May also be set via
     *  `GITNEXUS_PDG_EMIT_CHUNK_SIZE`. Memory-only (#2202). */
    pdgEmitChunkSize?: number;
    /** Streamed structural graph emit (#2680). Honored only on a full rebuild
     *  (`force === true`). May also be enabled via `GITNEXUS_STREAM_GRAPH_EMIT`.
     *  Trades community detection, process extraction and PDG taint summaries for
     *  a ~2.9x reduction of in-memory graph heap. */
    streamGraphEmit?: boolean;
    /**
     * Default branch threaded into generated AGENTS.md / CLAUDE.md so the
     * regression-compare example uses the configured branch instead of a
     * hardcoded "main" (#243). Resolved by the CLI; `undefined` here keeps the
     * "main" fallback for non-CLI callers (e.g. the server analyze worker).
     */
    defaultBranch?: string;
    /**
     * Index-branch selector (#2106, #2354). Distinct from `defaultBranch` (which
     * only affects generated AGENTS.md/CLAUDE.md base_ref text). When set, this
     * run is pinned to a per-branch index slot (`branches/<slug>/`) unless the
     * label matches the flat slot's recorded branch. When `undefined`, the run
     * always targets the flat workspace slot, which follows the checked-out
     * working tree; the auto-detected branch is only recorded as the slot's
     * informational label. Detached HEAD / non-git also map to the flat slot.
     */
    branch?: string;
    /**
     * User-provided alias for the registry `name` (#829). When set,
     * forwarded to `registerRepo` so the indexed repo is stored under
     * this alias instead of the path-derived basename.
     */
    registryName?: string;
    /**
     * Bypass the `RegistryNameCollisionError` guard and allow two paths
     * to register under the same `name` (#829). Controlled by the
     * dedicated `--allow-duplicate-name` CLI flag, intentionally
     * independent from `--force` — users who hit the collision guard
     * should be able to accept the duplicate without paying the cost
     * of a pipeline re-index.
     */
    allowDuplicateName?: boolean;
    /**
     * Worker pool size override, threaded from the CLI `--workers` flag.
     * Forwarded to `PipelineOptions.workerPoolSize` so the parse phase
     * sizes the pool without `analyzeCommand` mutating `process.env`.
     * Must be a positive integer — `0` hard-errors (sequential parsing was
     * removed); `undefined` defers to the env / auto-formula fallback.
     */
    workerPoolSize?: number;
    /**
     * Extra fetch-wrapper function names to treat as HTTP consumers, forwarded to
     * `PipelineOptions.fetchWrappers` (#1589/#1852 residual). Sourced from the CLI
     * `.gitnexusrc` `fetchWrappers` list. `undefined`/empty leaves the route
     * consumer scan unchanged.
     */
    fetchWrappers?: string[];
    /**
     * The caller will `process.exit()` immediately after this analyze returns (the
     * CLI `analyze` command). When set, the finalize/error close CHECKPOINTs for
     * durability but skips the native `conn.close()`/`db.close()`, which can
     * double-free in LadybugDB's `ClientContext` destructor after large `--pdg`
     * writes (gdb-confirmed) — aborting the process AFTER a fully-written index.
     * Process exit reclaims the handles. Long-lived callers (MCP server, tests)
     * leave this unset so they get a real close. See `closeLbug`. */
    skipNativeCloseOnExit?: boolean;
}
export interface AnalyzeResult {
    repoName: string;
    repoPath: string;
    stats: {
        files?: number;
        nodes?: number;
        edges?: number;
        communities?: number;
        processes?: number;
        embeddings?: number;
    };
    alreadyUpToDate?: boolean;
    /** The raw pipeline result — only populated when needed by callers (e.g. skill generation). */
    pipelineResult?: any;
    /** True when analyze only repaired FTS indexes and skipped pipeline re-analysis. */
    ftsRepairedOnly?: boolean;
    /**
     * True when the FTS extension was unavailable so search-index creation was
     * skipped (offline-first degradation). The graph is fully queryable; only
     * full-text/BM25 search is disabled. Lets callers (CLI summary, server) and
     * the persisted meta surface the degraded state instead of reporting healthy.
     */
    /**
     * Set when the post-write integrity check found far fewer relationships in
     * the DB than the pipeline produced. Surfaced on the RESULT, not only in
     * metadata, because the CLI and the analyze worker both report completion
     * from this object — and a run whose edges are mostly gone must not be able
     * to print "indexed successfully" and exit 0.
     */
    graphWriteCollapsed?: {
        expected: number;
        persisted: number;
    };
    ftsSkipped?: boolean;
    /**
     * Why FTS was skipped, when `ftsSkipped` is true (#2658 review L2):
     * `extension-unavailable` (the LadybugDB FTS extension could not load — the
     * offline-first case, remedied by installing it) vs `build-failed` (the
     * extension loaded but the index build/verify failed non-fatally — remedied by
     * `--repair-fts`, not by installing the extension). Lets the CLI show the
     * correct recovery hint instead of always blaming a missing extension.
     */
    ftsSkipReason?: 'extension-unavailable' | 'build-failed';
    /**
     * True when the index this run produced/validated is the flat workspace
     * slot (#2106 R2, inverted by #2354 to follow the checked-out branch).
     * `false` for a pinned `--branch` sub-index. Lets the CLI skip repo-root
     * AGENTS.md/CLAUDE.md refreshes (e.g. the base_ref fast-path) for a pinned
     * branch analyze, mirroring the in-pipeline `if (!placement.branch)` gate.
     * (The historical "primary" name is kept — it is public API surface.)
     */
    isPrimaryBranch?: boolean;
}
export { deriveEmbeddingMode, DEFAULT_EMBEDDING_NODE_LIMIT } from './embedding-mode.js';
export type { EmbeddingMode } from './embedding-mode.js';
import type { GraphEmitManifest } from './lbug/graph-emit-sink.js';
/**
 * Relationships RESIDENT in the in-memory graph, excluding the PDG layers —
 * the heap-side counterpart of the sink's `structuralRows` subtotal and of
 * `getLbugStats().structuralEdges`, counted by the same `PDG_EDGE_TYPES`
 * predicate so all three measure one population.
 *
 * A type-aware scan rather than `graph.relationshipCount`, because that count is
 * PDG-INCLUSIVE on every run that does not stream. `resolveStreamPdgEmit` and
 * `resolveStreamGraphEmit` BOTH require `force === true`, so with no `--force`
 * there is no sink at all and `scope-resolution/pipeline/run.ts` writes the PDG
 * layers into the ordinary graph (`input.pdgEmitSink ?? graph`). Measured
 * directly: one `runScopeResolution({ pdg: true })` with no sink leaves
 * `relationshipCount = 1`, all of it `CFG`. A first-time `analyze --pdg` on a
 * fresh repo is a FULL write (so the collapse check runs) and a non-streaming
 * one, so `relationshipCount` there compares structural-plus-PDG against a
 * structural-only measurement — the same false collapse the streamed path
 * already fixed, on the default configuration rather than the `--force` one.
 *
 * `forEachRelationshipFields` is the zero-allocation columnar scan (~90 ms per
 * million edges) and `pipelineResult.graph` is always the RAW graph, never the
 * sink, so this never has to recall an offloaded edge.
 *
 * `NaN` when the graph cannot be scanned at all, which is the SAME fact the
 * previous `graph.relationshipCount` read produced for such a graph (`undefined
 * + streamedRows`), and which `detectGraphWriteCollapse` maps to an explicit
 * `'unmeasurable'`. Its docstring already names "a graph implementation that
 * reports no total, a lightweight pipeline result" as an expected input, so
 * calling an absent method here would convert a documented no-verdict into a
 * crashed analyze.
 */
export declare function countStructuralRelationships(graph: Partial<Pick<KnowledgeGraph, 'forEachRelationshipFields'>> | undefined): number;
/**
 * The STRUCTURAL relationship count a healthy write is expected to persist.
 *
 * Exported and called by production rather than mirrored in a test. That is the
 * point: the wiring test kept a LOCAL COPY of this expression "because the
 * production expression is inline in a 3000-line function", and a copy cannot
 * catch a term the original got wrong. It did not catch this one.
 *
 * BOTH terms are objects, not pre-selected numbers, and for the same reason:
 * every defect this expression has had was a wrong FIELD chosen at a call site
 * no unit test can reach — first `totalRows` over `structuralRows`, then
 * `relationshipCount` over the structural subtotal. Taking the graph and the
 * manifest puts both choices inside the tested function.
 */
export declare function computeExpectedStructuralRelationships(
/**
 * The in-memory graph, NOT its `relationshipCount`. That count includes the
 * PDG layers whenever they did not stream — which is every run without
 * `--force`, i.e. the default configuration. A graph that cannot be scanned
 * yields `NaN`, i.e. an explicit no-verdict, exactly as an absent
 * `relationshipCount` did.
 */
graph: Partial<Pick<KnowledgeGraph, 'forEachRelationshipFields'>> | undefined, 
/**
 * The MANIFEST, not a pre-selected number. Taking the whole object puts the
 * `structuralRows` / `totalRows` choice INSIDE the tested function — the
 * choice that was wrong before, and that a numeric parameter leaves at an
 * untestable call site.
 */
graphEmitManifest: Pick<GraphEmitManifest, 'structuralRows' | 'totalRows'> | undefined): number;
/**
 * Which `graphWriteCollapsed` stamp a finished run should PERSIST.
 *
 * Split on the VERDICT, never on the write mode. `saveMeta` overwrites
 * meta.json atomically rather than merging, so returning `undefined` DELETES
 * the stamp — and the stamp is what marks the index incomplete and forces the
 * rebuild that repairs it. Only a positive `'healthy'` measurement earns that
 * deletion; `'unmeasurable'` means this run compared nothing, and a run that
 * measured nothing has repaired nothing.
 *
 * Exported and called by production for the same reason
 * {@link computeExpectedStructuralRelationships} is: the previous version of
 * this decision lived inline in a 3000-line function, where no unit test could
 * reach it, and it shipped implementing a documented three-way taxonomy as a
 * two-way branch on `wroteChangedSubgraphOnly`.
 */
export declare function selectPersistedCollapseStamp(verdict: GraphWriteCollapseVerdict, 
/** The stamp already on disk. Survives every non-`'healthy'` verdict. */
previousStamp: RepoMeta['graphWriteCollapsed']): RepoMeta['graphWriteCollapsed'];
export declare const PHASE_LABELS: Record<string, string>;
/**
 * Run the full GitNexus analysis pipeline.
 *
 * This is the shared core extracted from the CLI `analyze` command. It
 * handles: pipeline execution, LadybugDB loading, FTS indexing, embedding
 * generation, metadata persistence, and AI context file generation.
 *
 * The function communicates progress and log messages exclusively through
 * the {@link AnalyzeCallbacks} interface — it never writes to stdout/stderr
 * directly and never calls `process.exit()`.
 */
/**
 * Collect the recorded parse-cache chunk keys across the flat + every branch
 * metadata directory under a flat `.gitnexus` storage, EXCLUDING `excludeDir`
 * (the current run's own meta dir) so a single-branch repo collects nothing and
 * its prune stays byte-identical to today (#2106 R6 — the byte-identity claim
 * is about the PRUNE result; the metadata FILENAME read here changed with
 * PR #2363's rename, checking `gitnexus.json` first then the legacy
 * `meta.json` mirror). `complete` is false when a sibling metadata file exists
 * but fails to read or parse — callers then retain the whole shared cache
 * rather than over-evict another branch's still-live shards. Exported for
 * testing.
 */
export declare const collectBranchCacheKeys: (storagePath: string, excludeDir?: string) => Promise<{
    keys: Set<string>;
    complete: boolean;
}>;
/**
 * Resolve the requested `--pdg` configuration to the shape recorded in
 * `RepoMeta.pdg`, or `undefined` for a pdg-off run. Caps resolve to their
 * defaults so an explicit-default run compares equal to a default run
 * (`0` = unlimited is preserved as `0`). Pure + exported for testing.
 */
type PdgOptions = Pick<AnalyzeOptions, 'pdg' | 'pdgMaxFunctionLines' | 'pdgMaxEdgesPerFunction' | 'pdgMaxReachingDefEdgesPerFunction' | 'pdgMaxCdgEdgesPerFunction' | 'pdgMaxTaintFindingsPerFunction' | 'pdgMaxTaintHops' | 'pdgMaxInterprocFindings' | 'pdgMaxInterprocHops' | 'pdgMaxInterprocEdges'>;
export declare const resolvePdgConfig: (options: PdgOptions) => RepoMeta["pdg"];
/**
 * Whether streaming/chunked PDG graph emit (#2202) engages this run.
 *
 * Streaming flushes the BasicBlock + intra-file PDG-edge layer to CSV-on-disk
 * during the emit loop and never lands it in the in-memory graph, bounding peak
 * RSS to O(chunk). It is sound ONLY on a full rebuild: the incremental
 * writeback (`extractChangedSubgraph`) reads BasicBlock nodes back out of the
 * in-memory graph, which streaming has already offloaded. `force === true` is
 * the pre-pipeline guarantee of a full rebuild — `isIncremental` has
 * `!force` as a necessary condition — so gating on it avoids the deliberately
 * absent pre-pipeline incremental prediction (see the `isIncremental` note).
 *
 * Requires `pdg === true` (nothing to stream otherwise). Enabled by either the
 * explicit `streamPdgEmit` option or the `GITNEXUS_STREAM_PDG_EMIT` env toggle.
 * Memory-only — NOT part of {@link resolvePdgConfig}, so toggling it never
 * trips `pdgModeMismatch`. Read every call (not memoized) so `vi.stubEnv`
 * works in tests. Pure + exported for testing.
 */
export declare const resolveStreamPdgEmit: (options: {
    pdg?: boolean;
    force?: boolean;
    streamPdgEmit?: boolean;
}) => boolean;
/**
 * Resolve whether streamed structural graph emit is on for this run (#2680).
 *
 * **On by default.** It costs nothing observable: the sink answers a complete
 * relationship read, so community detection, process extraction, the taint
 * fixpoint and the local-symbol pruner all behave exactly as they do without it
 * — the edges simply live in columns and on disk instead of as objects. There is
 * no reason to make a user opt in to using less memory.
 *
 * Two conditions still bound it:
 *
 * - `force === true`. Sound only on a full rebuild, because the incremental
 *   writeback (`extractChangedSubgraph`) reads relationships back out of the
 *   in-memory graph. Same gate, and same reason, as {@link resolveStreamPdgEmit}.
 * - `GITNEXUS_STREAM_GRAPH_EMIT=0` (or an explicit `streamGraphEmit: false`)
 *   turns it off. The escape hatch exists for bisecting a suspected
 *   streaming-related fault, not as a routine choice.
 *
 * Memory-only: not part of {@link resolvePdgConfig}, so toggling never trips
 * `pdgModeMismatch`. Read every call (not memoized) so `vi.stubEnv` works.
 */
export declare const resolveStreamGraphEmit: (options: {
    force?: boolean;
    streamGraphEmit?: boolean;
}) => boolean;
/**
 * Resolve the streamed PDG-emit write-buffer size (#2202). Explicit option wins
 * over `GITNEXUS_PDG_EMIT_CHUNK_SIZE`; `undefined` ⇒ the sink's
 * `DEFAULT_PDG_EMIT_CHUNK_ROWS`. Memory-only; does not affect emitted bytes.
 */
export declare const resolvePdgEmitChunkSize: (options: {
    pdgEmitChunkSize?: number;
}) => number | undefined;
/**
 * Whether the requested `--pdg` configuration differs from the one the
 * existing index's DB rows were built under (#2099 F1). An absent recorded
 * stamp means pdg-off (every legacy meta — `--pdg` shipped opt-in). Any
 * mismatch means the incremental writeback (which only persists changed-file
 * nodes) cannot produce a coherent index: off→on would silently drop the
 * freshly built CFG layer, on→off would strand zombie BasicBlocks — so the
 * caller forces a full writeback. Pure + exported for testing.
 */
export declare const pdgModeMismatch: (recorded: RepoMeta["pdg"], options: PdgOptions) => boolean;
/**
 * Run the full analysis under an exclusive, index-directory-scoped write lock
 * (#2658). A second concurrent `analyze` on the same slot waits here for the
 * first to finish, then falls through to the normal freshness check inside —
 * so a run whose work the holder already did returns `alreadyUpToDate` in
 * seconds instead of rebuilding (single-flight coalescing), while a run for a
 * genuinely-changed tree does one follow-up incremental. No new flag: waiting
 * is the default, which is what hook-driven re-index wants.
 *
 * The lock is held by whichever process runs the pipeline (the heap-respawn
 * child, or the original) — see index-lock.ts for why ownership lives with the
 * writer, not a supervising parent. Released as soon as the write completes or
 * throws; the post-analysis steps in the CLI (skills, registry) run lock-free.
 */
export declare function runFullAnalysis(repoPath: string, options: AnalyzeOptions, callbacks: AnalyzeCallbacks, runnerIdentityAtBootstrap?: AnalyzerRunnerIdentity): Promise<AnalyzeResult>;
