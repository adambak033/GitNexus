/**
 * Local Backend (Multi-Repo)
 *
 * Provides tool implementations using local .gitnexus/ indexes.
 * Supports multiple indexed repositories via a global registry.
 * LadybugDB connections are opened lazily per repo on first query.
 */
import { type RegistryEntry, type BranchSummary } from '../../storage/repo-manager.js';
import { GroupService } from '../../core/group/service.js';
import { type StalenessInfo } from '../../core/git-staleness.js';
/**
 * Quick test-file detection for filtering impact results.
 * Matches common test file patterns across all supported languages.
 */
export declare function isTestFilePath(filePath: string | null | undefined): boolean;
/** Valid LadybugDB node labels for safe Cypher query construction */
export declare const VALID_NODE_LABELS: Set<string>;
/** Valid relation types for impact analysis filtering */
export declare const VALID_RELATION_TYPES: Set<string>;
/**
 * Relation types the #1858 epistemic-boundary probe keys on. Kept as
 * module-level `readonly` arrays (not Sets) because computeEpistemicBoundary
 * binds them as Cypher query params (`r.type IN $heritage` / `IN $types`).
 * The heritage set is exactly the IMPACT_RELATION_CONFIDENCE 0.85 tier —
 * "statically verifiable, but the concrete binding past it is not".
 */
export declare const EPISTEMIC_HERITAGE_RELATION_TYPES: readonly string[];
export declare const EPISTEMIC_CONSUMER_RELATION_TYPES: readonly string[];
/**
 * Per-relation-type confidence floor for impact analysis.
 *
 * When the graph stores a relation with a confidence value, that stored
 * value is used as-is (it reflects resolution-tier accuracy from analysis
 * time).  This map provides the floor for each edge type when no stored
 * confidence is available, and is also used for display / tooltip hints.
 *
 * Rationale:
 *   CALLS / IMPORTS  – direct, strongly-typed references → 0.9
 *   EXTENDS          – class hierarchy, statically verifiable → 0.85
 *   IMPLEMENTS       – interface contract, statically verifiable → 0.85
 *   METHOD_OVERRIDES  – method override, statically verifiable → 0.85
 *   METHOD_IMPLEMENTS – interface method implementation, statically verifiable → 0.85
 *   HAS_METHOD       – structural containment → 0.95
 *   HAS_PROPERTY     – structural containment → 0.95
 *   ACCESSES         – field read/write, may be indirect → 0.8
 *   CONTAINS         – folder/file containment → 0.95
 *   (unknown type)   – conservative fallback → 0.5
 */
export declare const IMPACT_RELATION_CONFIDENCE: Readonly<Record<string, number>>;
export interface CodebaseContext {
    projectName: string;
    stats: {
        fileCount: number;
        functionCount: number;
        communityCount: number;
        processCount: number;
    };
}
/** Collapse dropped-site boundary notes into an epistemic verdict: any note at
 *  all means the count is a lower bound, none means it is exact (#2744). */
/**
 * Why a count is a lower bound, as a machine-readable split.
 *
 * `epistemic` is a single enum and `boundaries` is prose, so a consumer that is
 * not a human — a coding agent gating its own edits on this result — can tell
 * THAT the answer is short but not WHY, and cannot branch on the difference.
 * The two causes are independent and have opposite remedies:
 *
 * - `receiverTyping` — the analyzer dropped call sites because it could not
 *   establish the receiver's type. A resolver defect. Fixable, and shrinking:
 *   this is the population the structural-receiver work targets.
 * - `dispatchBoundary` — the symbol sits behind an interface with real
 *   consumers or multiple implementations, so callers binding through a DI
 *   container or dynamic dispatch are genuinely untraceable statically. NOT a
 *   defect; a compiler would refuse here too.
 *
 * Collapsing them told the reader "impact may be higher" for both, which made
 * the fixable cause indistinguishable from the irreducible one — and made
 * "the hedge should stop appearing" an unfalsifiable goal, because there was no
 * way to see which producer was still firing.
 *
 * Every field counts MISSING THINGS, never notes. The unit is stated per field
 * because the two producers can only measure at different granularities (see
 * `dispatchBoundary`), and a consumer comparing the numbers has to know which
 * it is holding. Counting notes here is the specific mistake to avoid: there is
 * one note per symbol name / per boundary node, so a note count reports the
 * number of SENTENCES, which has no relation to how much is missing.
 */
export interface EpistemicCauses {
    /**
     * Call SITES dropped at index time because the receiver's type could not be
     * established. Unit: call sites, taken from the index's
     * `unresolvedReceiverMembers` summary — the same number the prose note quotes.
     */
    readonly receiverTyping: number;
    /**
     * Symbols on the far side of a dispatch boundary that the traversal could not
     * attribute to the queried symbol: implementations plus interface-level
     * consumers, summed over the boundary nodes that were flagged.
     *
     * Unit: SYMBOLS, not call sites — deliberately, because a call-site count is
     * not derivable on this side. The graph does not retain per-site multiplicity
     * for these edges: consumers are counted with `COUNT(DISTINCT other.id)`, and
     * languages that set `collapseMemberCallsByCallerTarget` emit one CALLS edge
     * per (caller, target) pair no matter how many syntactic sites exist. A
     * symbol reachable through two flagged boundary nodes is counted once per
     * node, so this is itself a lower bound.
     *
     * It is still directly comparable in magnitude with `receiverTyping` — both
     * answer "how much is missing" — which `boundaries.length` was not.
     */
    readonly dispatchBoundary: number;
    /**
     * Call sites whose receiver was rooted OUTSIDE the indexed program —
     * `System.out.println`, `fetch(...)`, `os.environ.*`. Reported, but NOT a
     * reason the count is short: there is no in-graph node an edge could have
     * reached, so the analysis is complete for the program as given.
     *
     * Surfaced so "no uncertainty" is distinguishable from "we judged 76 calls to
     * be outside the program". A compiler resolves these against the JDK / BCL /
     * lib.d.ts; lacking those, this number IS the boundary.
     *
     * Unit: call sites — same unit and same source as `receiverTyping`.
     */
    readonly externalBoundary: number;
    /**
     * Interface-satisfaction checks the ANALYZER could not complete, on a
     * boundary this query crossed (#2873). Unit: unjudged (interface, candidate
     * type) pairs.
     *
     * Distinct from every slot above, which count facts the analyzer decided and
     * then could not attribute. This one counts questions it never answered — a
     * type in a required signature had no identity to compare, so no IMPLEMENTS
     * edge was minted and no dispatch boundary exists for the walk to notice. It
     * is the one cause that makes a result short WITHOUT leaving a trace in the
     * graph, which is why it has to be read from the index metadata instead.
     *
     * Zero on any index written before the field existed; that reads the same as
     * "nothing was undecided", and a re-index is what tells the two apart.
     */
    readonly undecidedSatisfaction: number;
}
interface RepoHandle {
    id: string;
    name: string;
    repoPath: string;
    storagePath: string;
    lbugPath: string;
    indexedAt: string;
    lastCommit: string;
    remoteUrl?: string;
    stats?: RegistryEntry['stats'];
    /** Primary/flat branch name, when known (#2106). */
    branch?: string;
    /** Pinned `--branch` sub-indexes available for this repo, distinct from the flat workspace slot (#2106/#2354). */
    branches?: BranchSummary[];
}
/**
 * Resolve the git diff cwd for detect_changes, auto-detecting linked worktrees.
 *
 * When `launchCwd` is a linked worktree of the same canonical repository as
 * `repoPath` (i.e. `getGitRoot(launchCwd)` differs from `repoPath` but both
 * share the same `getCanonicalRepoRoot`), returns the worktree's git root so
 * that `git diff` sees the correct working directory and index.
 *
 * Returns `repoPath` unchanged in all other cases (non-worktree, git
 * unavailable, unrelated repo).
 *
 * Extracted as a module-level export so tests can pass any `launchCwd` instead
 * of relying on `process.cwd()`, which is fixed to the server launch directory
 * and cannot be changed mid-process.
 */
export declare function resolveWorktreeCwd(repoPath: string, launchCwd: string): string;
export declare function buildDetectChangesDiffArgs(scope: string, baseRef?: string): string[] | null;
/**
 * Length of the path-derived suffix appended to a colliding repo id.
 * Exported so tests can pin the suffix shape without re-deriving the
 * literal; see `assignRepoId()` and the hashed-id resolution tier (#1658).
 *
 * Note: base64url is an *encoding*, not a hash — it preserves byte order, so
 * two paths that share a long common prefix (sibling clones under one parent)
 * collapse to the same sliced suffix. `assignRepoId()` keeps the legacy
 * base64url suffix only for the first colliding duplicate (id compatibility)
 * and falls back to a content hash of the resolved path on a real collision
 * (#2054).
 */
export declare const REPO_ID_HASH_LENGTH = 6;
/**
 * One repository entry as returned by {@link LocalBackend.listRepos} and in each
 * `list_repos` page. Named so the `listRepos`/`listReposPage` return types read
 * clearly instead of an opaque `Awaited<ReturnType<…>>` expression.
 */
export interface RepoListing {
    name: string;
    path: string;
    indexedAt: string;
    lastCommit: string;
    remoteUrl?: string;
    stats?: any;
    staleness?: {
        commitsBehind: number;
        hint?: string;
    };
    siblings?: Array<{
        name: string;
        path: string;
        lastCommit: string;
    }>;
    /** Primary/flat branch name, when known (#2106). */
    branch?: string;
    /** Pinned `--branch` sub-indexes available for this repo, distinct from the flat workspace slot (#2106/#2354). */
    branches?: Array<Omit<BranchSummary, 'stats'>>;
}
/** Continuation metadata for the paginated `list_repos` MCP tool (#2119). */
export interface ListReposPagination {
    /** Total repositories across all pages. */
    total: number;
    /** Effective page size used (equals the requested limit; out-of-range is rejected, not clamped). */
    limit: number;
    /** Offset this page started at. */
    offset: number;
    /** Number of repositories actually returned in this page. */
    returned: number;
    /** True when more repositories remain past this page. */
    hasMore: boolean;
    /** Offset to request next; present only when `hasMore` is true. */
    nextOffset?: number;
}
/**
 * #2655: attach a non-blocking `staleness` signal to a tool result when the
 * index is behind HEAD, mirroring the `list_repos` `{commitsBehind, hint}`
 * shape. Only ever ADDS a field to a carryable object result (see
 * {@link canCarryStaleness}) — it never changes an existing result's shape.
 */
export declare function attachToolStaleness(result: unknown, staleness: StalenessInfo | undefined): unknown;
export declare class LocalBackend {
    private static readonly TOOL_STALENESS_TTL_MS;
    private repos;
    private contextCache;
    private initializedRepos;
    private reinitPromises;
    private lastStalenessCheck;
    private toolStalenessCache;
    private lastObservedPoolState;
    /** Merge-patch one poolKey's observed state, preserving fields not passed. */
    private setObservedState;
    private groupToolSvc;
    /**
     * One-shot stderr warnings for sibling-clone drift, keyed by
     * `${repoId}|${cwdGitRoot}`. Without this guard every tool call
     * from inside a sibling clone would print the same warning,
     * making MCP stderr unreadable.
     */
    private warnedSiblingDrift;
    /**
     * One-shot stderr warning for the VECTOR-extension fallback. Without this
     * guard the diagnostic would fire on every `semanticSearch()` call on
     * platforms where the extension is unsupported (e.g. Windows), making MCP
     * stderr noisy per DoD §2.8.
     */
    private warnedVectorUnsupported;
    /**
     * One-shot warning when a pruned or Node-unloadable optional embedding stack
     * (#2370/#2372) forces semantic search to fall back to BM25 — so the
     * degradation is visible once instead of silent.
     */
    private warnedMissingEmbeddingStack;
    /**
     * Width the semantic lane last produced a QUERY vector at for an index, keyed
     * by `lbugPath` (like `lastObservedPoolState`, and for the same reason: branch
     * handles are rebuilt by `applyBranchScope` on every `resolveRepo`, so state
     * hung off the handle would not survive to the next call).
     *
     * Exists so `query()` can raise the vector-column drift warning (#2798) ONLY
     * where a width actually matters — a call that embedded something. The lane
     * returns before importing the embedder when the index holds no vectors, and
     * swallows an unavailable/pruned embedder into `[]`; a width complaint about
     * either is noise about a comparison that never happened, and every index
     * analyzed without `--embeddings` would carry it on every query.
     *
     * Recorded rather than recomputed at the warning site because the comparand
     * must be the width the CAST actually binds — `getEmbeddingDims()` (the HTTP
     * dimensions, else the local model's fixed 384), NOT `schema.ts`'s
     * env-derived `EMBEDDING_DIMS`. Those two disagree exactly when
     * `GITNEXUS_EMBEDDING_DIMS` is set on a server embedding LOCALLY, where the
     * env value is the one the query path ignores — comparing against it would
     * report drift on a lane that is working fine.
     *
     * Written only on definite outcomes (set once a vector exists, deleted where
     * the lane provably embedded nothing), so concurrent queries against one
     * index write the same value and an entry never outlives the fact it records.
     */
    private lastQueryEmbeddingDims;
    /**
     * Cross-repo group tools (CLI). Shares logic with MCP `group_*` handlers.
     */
    getGroupService(): GroupService;
    /**
     * Adapt local `trace` to the group port. The assembled group/cross-repo trace
     * presents 1-based endpoints (via resolveSymbolForGroup), so convert the hop
     * lines here too — otherwise one response mixes 1-based endpoints with 0-based
     * hops (#2380). Single-repo `trace` dispatches directly (not through this
     * port) and stays 0-based (documented full-parity follow-up).
     */
    private traceForGroup;
    /**
     * Adapt the shared symbol resolver to the GroupToolPort contract. Used by the
     * cross-repo trace path to locate which member repo an endpoint lives in and
     * recover its node id (== bridge `Contract.symbolUid`).
     */
    private resolveSymbolForGroup;
    /**
     * Intra-procedural REACHING_DEF data-flow for a single anchor symbol, adapted
     * to the GroupToolPort contract. Reuses the same anchor + `flows` query as the
     * `pdg_query` tool. `available:false` (not an error) when the repo has no PDG
     * `flows` layer, so the cross-repo trace degrades to call-level hops.
     */
    private pdgFlowsForGroup;
    /**
     * Intra-procedural REACHING_DEF data-flow within the anchor symbol's block
     * span. Reuses the same anchored, bind-param-only `flows` query as
     * `pdg_query` (no rel-property index ⇒ the BasicBlock id-prefix + line-span
     * anchor IS the bound). The anchor is resolved by UID when available (the
     * boundary symbol is known precisely), avoiding the name-ambiguity the
     * by-name `resolveBlockAnchor` path can hit. Data flow never crosses the repo
     * boundary — this only describes how values move toward the boundary call
     * inside one function.
     */
    private _pdgFlowsForGroupImpl;
    /** Close all pooled LadybugDB connections (CLI one-shot; optional for long-lived MCP). */
    dispose(): Promise<void>;
    /**
     * Initialize from the global registry.
     * Returns true if at least one repo is available.
     */
    init(): Promise<boolean>;
    /**
     * Re-read the global registry and update the in-memory repo map.
     * New repos are added, existing repos are updated, removed repos are pruned.
     * LadybugDB connections for removed repos are NOT closed (they idle-timeout naturally).
     */
    private refreshRepos;
    /**
     * Assign a collision-free in-memory id for a registered repo.
     *
     * - Unique name → the bare lowercased name.
     * - Duplicate name → a path-derived suffix. The *first* colliding clone keeps
     *   the legacy `base64url(path)` suffix so ids generated before #2054 still
     *   resolve (the #1658 hashed-id tier). base64url is an encoding, not a hash:
     *   it preserves byte order, so sibling clones under one parent (e.g.
     *   `.../REPO_2` and `.../REPO_3`) yield identical leading characters and thus
     *   the same sliced suffix. Any further collision therefore falls back to a
     *   content hash of the *resolved* path (order-insensitive), extended
     *   deterministically until unique.
     *
     * `assigned` maps every id handed out in this refresh to its resolved path,
     * so a candidate is "free" when it is unused or already owned by this exact
     * path. This method records its own assignment into `assigned` before
     * returning, so the map-update is the function's invariant, not a caller
     * obligation. A returned id never overwrites a different path's handle (#2054).
     */
    private assignRepoId;
    /**
     * Resolve which repo to use.
     * - If repoParam is given, match by name or path
     * - If only 1 repo, use it
     * - If 0 or multiple without param, throw with helpful message
     *
     * On a miss, re-reads the registry once in case a new repo was indexed
     * while the MCP server was running.
     */
    resolveRepo(repoParam?: string, branch?: string): Promise<RepoHandle>;
    /**
     * Re-point a resolved repo handle at a specific branch index (#2106).
     *
     * - No `branch` (default) → the flat workspace handle, unchanged (backward
     *   compatible: every existing caller passes no branch).
     * - `branch` equal to the flat slot's **on-disk** recorded branch → the
     *   flat handle. The disk meta is read before any cached state is trusted
     *   (#2364 review F1): the flat slot follows the checked-out working tree
     *   (#2354), so a plain analyze after a branch switch restamps the meta
     *   without any repo-resolution miss that would refresh a long-lived
     *   server's cached handle — the cached label can otherwise serve another
     *   branch's content under the old name (the pool staleness reinit
     *   hot-swaps content without updating `handle.branch`).
     * - `branch` matching an indexed pinned branch → a handle whose
     *   `lbugPath` points at `branches/<slug>/lbug`; the connection pool keys by
     *   `lbugPath`, so this is the only change needed to scope every tool. The
     *   sub-index lbug must actually exist on disk — `adoptFlatBranchLabel`
     *   deletes the whole dir when the flat slot takes ownership, and a stale
     *   cached summary must not route to the deleted path.
     * - Cached `handle.branch` is trusted only when there is no readable flat
     *   meta to contradict it (legacy shapes, #2106 R4).
     * - Any miss → a clear error (never a silently-empty result against the
     *   wrong DB), after exactly one `refreshRepos()` so newly-pinned branches
     *   and restamped labels the cached handle predates resolve on the next
     *   call.
     */
    private applyBranchScope;
    /**
     * Try to resolve a repo from the in-memory cache. Returns null on miss.
     * Throws {@link RegistryAmbiguousTargetError} when `repoParam` matches
     * multiple handles by name and cwd cannot disambiguate (#1658).
     */
    private resolveRepoFromCache;
    /**
     * Prefer the indexed repo whose path matches the git root of process.cwd().
     *
     * In MCP stdio server mode, `process.cwd()` is the server's launch directory,
     * not the agent client's cwd. If the server was started from an unrelated
     * directory, `getGitRoot` returns null and duplicate-name resolution throws
     * {@link RegistryAmbiguousTargetError} — callers should pass an absolute path.
     */
    private pickRepoHandleForCwd;
    private handleToRegistryEntry;
    /**
     * Ensure the LadybugDB pool is open for the *resolved* repo.
     *
     * Takes the `RepoHandle` the caller resolved — NOT a bare id — and keys the
     * pool (and the init/staleness/reinit maps) by the immutable `lbugPath`. Two
     * things matter for multi-clone correctness: (1) the handle is the one the
     * caller resolved, so a concurrent `refreshRepos` can't substitute a different
     * clone; (2) the pool key is the database path, so distinct clones never share
     * a pool entry even when their name-derived id transiently collides (#2067).
     */
    private ensureInitialized;
    /**
     * Get context for a specific repo (or the single repo if only one).
     */
    getContext(repoId?: string): CodebaseContext | null;
    /**
     * List all registered repos with their metadata.
     * Re-reads the global registry so newly indexed repos are discovered
     * without restarting the MCP server.
     *
     * Each entry includes:
     *   - `staleness`: if the indexed clone's own HEAD has moved past
     *     the recorded `lastCommit` (option D in the issue's fix list).
     *   - `siblings`: other registered entries sharing the same
     *     `remoteUrl` (option B's payoff: callers can see at a glance
     *     that another clone of the same logical repo is registered).
     *   - `remoteUrl`: the canonical origin URL recorded at index time.
     */
    listRepos(): Promise<RepoListing[]>;
    /**
     * Paginated view over {@link listRepos} for the `list_repos` MCP tool (#2119).
     *
     * `listRepos()` itself still returns the FULL array — its resource and CLI
     * consumers (`gitnexus://repos`, `gitnexus://setup`, startup logs) need every
     * entry, so pagination lives ONLY here, on the tool surface, to keep the
     * response under MCP/LLM token-truncation limits.
     *
     * Determinism: a single registry snapshot is taken per call, then sorted by
     * lower-cased name with the repository path as a tie-breaker. Sibling clones
     * share a name but never a path (#2054), so `(name, path)` is a total order —
     * paging never skips or duplicates an entry while the registry is unchanged.
     * Codepoint comparison (not `localeCompare`) keeps page boundaries stable
     * across machines/locales, matching the existing `refreshRepos` ordering.
     */
    listReposPage(params?: {
        limit?: unknown;
        offset?: unknown;
    } | null): Promise<{
        repositories: RepoListing[];
        pagination: ListReposPagination;
    }>;
    /**
     * Best-effort sibling-clone drift warning.
     *
     * When the resolved index has a `remoteUrl` recorded and the caller's
     * `process.cwd()` is inside a *different* clone of the same repo, emit
     * one stderr line per (repo, cwd) pair so the operator knows the
     * graph may be stale relative to what's actually on disk under their
     * cwd. Silent on path matches and on repos without a remote URL.
     *
     * Limitation: in MCP stdio server mode `process.cwd()` is the
     * server's CWD at start time, *not* the agent client's CWD. The
     * warning therefore only fires when the MCP server itself was
     * launched from inside a sibling clone (typical for `npx gitnexus
     * serve` from a polecat workspace). Surfacing the client's CWD
     * would require a per-tool-call `cwd` parameter — out of scope for
     * the current MCP contract.
     *
     * Pure side-effect (stderr); never affects the returned handle.
     * After the first computation for a given (repo, cwd) pair the
     * result is cached so subsequent `resolveRepo()` calls don't
     * re-shell-out to git.
     */
    private maybeWarnSiblingDrift;
    /**
     * #2655: attach a commits-behind freshness signal to a hot-read-tool result,
     * skipping the `git` spawn entirely for results that can't carry it (error
     * envelopes, arrays, non-objects — see {@link canCarryStaleness}) so an
     * error-returning call pays nothing.
     */
    private withToolStaleness;
    /**
     * #2655: commits-behind freshness for the hot read tools, deduped per index.
     * Returns a shared in-flight promise so concurrent tool calls spawn at most
     * one `git rev-list` per index per TTL window; the resolved value is cached
     * for TOOL_STALENESS_TTL_MS. Keyed by lbugPath so flat and branch handles
     * (same repoPath, different lastCommit) don't share an entry. Non-blocking by
     * construction: `checkStalenessAsync` swallows git failures to
     * `{ isStale: false }`, so a git error never fails the tool — it just omits
     * the `staleness` field.
     */
    private stalenessForTool;
    callTool(method: string, params: any): Promise<any>;
    /** Check repository graph invariants that are suitable for CI gating. */
    private check;
    /**
     * Query tool — process-grouped search.
     *
     * 1. Hybrid search (BM25 + semantic) to find matching symbols
     * 2. Trace each match to its process(es) via STEP_IN_PROCESS
     * 3. Group by process, rank by aggregate relevance + internal cluster cohesion
     * 4. Return: { processes, process_symbols, definitions }
     */
    private query;
    /**
     * BM25 keyword search helper - uses LadybugDB FTS for always-fresh results
     */
    private bm25Search;
    /**
     * Semantic vector search helper
     */
    private semanticSearch;
    executeCypher(repoName: string, query: string, params?: Record<string, unknown>): Promise<any>;
    private cypher;
    /**
     * Format raw Cypher result rows as a markdown table for LLM readability.
     * Falls back to raw result if rows aren't tabular objects.
     */
    private formatCypherAsMarkdown;
    /**
     * Aggregate same-named clusters: group by heuristicLabel, sum symbols,
     * weighted-average cohesion, filter out tiny clusters (<5 symbols).
     * Raw communities stay intact in LadybugDB for Cypher queries.
     */
    private aggregateClusters;
    private overview;
    /**
     * Patch the `type` field on candidates whose `labels(n)[0]` projection
     * came back empty — a known LadybugDB behaviour for several node types.
     *
     * Uses one scoped UNION query across the priority labels rather than
     * per-candidate round-trips, so cost is a single DB call regardless of how
     * many candidates need enrichment. No-op when every candidate already has a
     * non-empty type.
     *
     * The value labels (`Const` / `Variable` / `Static`) are included because a
     * value candidate otherwise surfaces with `kind: ""` — which reads as
     * "unknown kind" and, worse, makes the `kind` disambiguation hint unable to
     * filter it out (#2687).
     *
     * Failures are swallowed: label enrichment is an optimisation for
     * downstream scoring and #480 Class/Interface BFS seeding; if it fails
     * the symbol still resolves, just without the kind-priority bonus.
     */
    private enrichCandidateLabels;
    /**
     * Score a symbol candidate for disambiguation ranking.
     *
     * Deterministic, no DB round-trip:
     *   - base 0.50
     *   - +0.40 when file_path hint matches (substring, case-insensitive)
     *   - +0.20 when kind hint exactly matches the candidate's kind
     *   - when no kind hint, a small priority bonus (Class > Interface >
     *     Function > Method > Constructor) to preserve the intuition that
     *     class-level names are usually what the user wanted.
     *
     * Capped at 1.0. Intentionally simple and inspectable — a future v2 can
     * plug in BM25/embedding signals here without changing the surrounding
     * resolver shape.
     */
    private scoreCandidate;
    /**
     * Shared symbol resolver used by `context` and `impact`.
     *
     * Returns one of:
     *   - `{ kind: 'ok', symbol, resolvedLabel }` — single confident match
     *     (either direct UID, only one candidate after filtering, Class/
     *     Constructor collapse, or a top-scoring candidate with a clear gap
     *     to the runner-up).
     *   - `{ kind: 'ambiguous', candidates }` — multiple viable matches,
     *     sorted by score desc. Each candidate carries a relevance score.
     *   - `{ kind: 'not_found' }` — no matches at all.
     *
     * Preserves the #480 Class/Constructor preference: when the only
     * ambiguity is between a Class and its own Constructor (same name,
     * same filePath), the Class wins silently.
     */
    private resolveSymbolCandidates;
    /**
     * Context tool — 360-degree symbol view with categorized refs.
     * Disambiguation (ranked) when multiple symbols share a name.
     * UID-based direct lookup. No cluster in output.
     */
    private context;
    private _contextImpl;
    /**
     * #trpc-fork: BFS chain expansion for `context({chain_depth: N})`.
     *
     * Walks CALLS edges up to `maxDepth` hops from the seed symbol, in BOTH
     * directions (upstream callers AND downstream callees), and returns the
     * layered result so an agent can see the full procedure→workflow→sub-workflow
     * chain in a single call instead of chaining context() invocations.
     *
     * Output shape (one entry per depth, depth 0 = the seed itself):
     *   [
     *     { depth: 0, symbol: {seed} },
     *     { depth: 1, upstream: [...callers], downstream: [...callees] },
     *     { depth: 2, upstream: [...], downstream: [...] },
     *     ...
     *   ]
     *
     * Test-file nodes are deprioritized (pushed to the end of each list) so real
     * callers/callees surface first — same ORDER BY logic as the main incoming
     * /outgoing queries (Fix A). Cycles are broken via a global `visited` set
     * (a node visited at depth N is not re-emitted at depth N+1 even if it has
     * another path back into the frontier). Hard cap of 50 nodes per direction
     * per depth layer keeps the response bounded.
     */
    private _computeContextChain;
    /**
     * Resolve a `target` (file path OR symbol/function name) into a BasicBlock
     * SOURCE-block anchor, shared by `explain` (TAINTED) and `pdg_query`
     * (CDG/REACHING_DEF) — both reconstruct the symbol↔block join the same way
     * (there is no Function→BasicBlock edge). #2188 review: extracted from two
     * near-identical copies that had DRIFTED — `_explainImpl` used a 0-based,
     * un-widened span window that dropped a function's final-line block and could
     * leak a neighbor's line-above block; this single resolver applies the correct
     * `[symStart+1, symEnd+1]` window (1-based BasicBlock startLine vs 0-based
     * symbol span) to BOTH callers.
     *
     * Returns a BARE `anchorClause` (no leading `AND`) so each caller composes its
     * own `WHERE`; `early` carries the not-found/ambiguous payload (caller returns
     * it verbatim). `target` / symbol names flow only through `queryParams` bind
     * params — never interpolated into Cypher.
     */
    private resolveBlockAnchor;
    /**
     * Explain tool (#2083 M3 U6) — persisted taint-finding explanation.
     * WAL-aware wrapper mirroring `context`.
     */
    private explain;
    /**
     * Taint findings are persisted as `TAINTED` rows in CodeRelation whose
     * endpoints are BOTH BasicBlock nodes — the label anchor restricts every
     * query here to the BasicBlock→BasicBlock partition of the rel table
     * (which holds only the sparse, per-function-capped pdg layers), never a
     * global symbol-space scan (the S1 verdict; LadybugDB has no rel-property
     * index, so the label anchor IS the bound).
     *
     * Anchoring granularity:
     * - file target → BasicBlock id prefix (`BasicBlock:<filePath>:` — the
     *   shared `basicBlockId` template) with an exact-or-suffix path match so
     *   `vuln.ts` finds `src/vuln.ts`.
     * - symbol target → resolved via `resolveSymbolCandidates` (the context()
     *   path: ambiguous ⇒ ranked candidates, unknown ⇒ not-found), then the
     *   file id-prefix PLUS source-block startLine within the symbol's
     *   [startLine, endLine] span. Findings are intra-procedural, so filtering
     *   the SOURCE endpoint is sufficient — both endpoints share the function.
     *   Symbols without a line span degrade to the file-level filter.
     *
     * The per-finding `sinkKind` and hop path decode from the persisted
     * `reason` via the SHARED `taint/path-codec.ts` (the U4 write path encodes
     * with the same module — `;<kind>` header + ordered `variable:line` hops).
     */
    private _explainImpl;
    private pdgQuery;
    /**
     * Query the persisted PDG (#2086 M6) — the control/data-dependence analog of
     * `explain`. `controls` reads CDG ("under what condition does X run?", branch
     * sense 'T'|'F' in `reason`); `flows` reads REACHING_DEF (def→use, variable
     * name in `reason`). Intra-procedural, basic-block granular.
     *
     * Bounded by construction: the BasicBlock→BasicBlock partition holds only the
     * sparse, per-function-capped pdg layers, the query is anchored to one file/
     * symbol, and the page is LIMIT-bounded (validated integer, interpolated
     * because LadybugDB does not parameterize LIMIT). LadybugDB has no rel-
     * property index, so the anchor IS the bound — there is no anchorless mode.
     *
     * Symbol↔block join: there is no Function→BasicBlock edge; the SOURCE block
     * (`a` — controller for CDG, def for REACHING_DEF) is filtered by the
     * BasicBlock id-prefix (`basicBlockId` template) plus its `startLine` within
     * the symbol's span. BasicBlock `startLine` is 1-based while symbol-node
     * `startLine`/`endLine` are 0-based, so BOTH bounds are shifted +1
     * (`[symStart+1, symEnd+1]`) onto the block basis: the upper +1 keeps a
     * guard/def/use on the function's final line, and the lower +1 excludes an
     * adjacent function's block on the line directly above (#2188 review). Both
     * endpoints share the function (intra-procedural), so filtering the source
     * endpoint suffices.
     */
    private _pdgQueryImpl;
    /**
     * Legacy explore — kept for backwards compatibility with resources.ts.
     * Routes cluster/process types to direct graph queries.
     */
    private explore;
    /**
     * Detect changes — git-diff based impact analysis.
     * Maps changed lines to indexed symbols, then finds affected processes.
     */
    private detectChanges;
    /**
     * Rename tool — multi-file coordinated rename using graph + text search.
     * Graph refs are tagged "graph" (high confidence).
     * Additional refs found via text search are tagged "text_search" (lower confidence).
     */
    private rename;
    private trace;
    private _traceImpl;
    private impact;
    private _impactImpl;
    /**
     * Union of the leaf callee names invoked across a set of dependence-slice
     * blocks (`BasicBlock.callees`, space-joined at emit). Drives statement-precise
     * inter-procedural evidence: a first-hop callee reached from the criterion is
     * "proven" (callgraph-bridge) iff its name is in this set, else unproven-bridge.
     * Empty when the slice blocks call nothing or carry no harvested callees
     * (non-TS/JS or synthetic ENTRY/EXIT blocks) — the bridge then preserves
     * callgraph reach. A query failure is logged and degrades to empty (no proof),
     * never throws (the inter-procedural reach is still returned).
     */
    private calleesOfBlocks;
    /**
     * Union of the RESOLVED callee symbol ids invoked across a set of
     * dependence-slice blocks (`BasicBlock.calleeIds`, space-joined at emit —
     * sibling of `callees`). This is the SOUND key the bridge prefers: a first-hop
     * callee is proven statement-precise iff its resolved id is in this set, which
     * eliminates the same-leaf-name collision (false-positive) and import-alias
     * (false-negative) the name set cannot distinguish. Empty when the slice blocks
     * carry no captured ids (pre-v3 index without the `calleeIds` column, or
     * non-overloading/synthetic blocks) — the bridge then falls back to the
     * leaf-name match per U5. A query failure is logged and degrades to empty (no
     * proof), never throws (the inter-procedural reach is still returned). Mirrors
     * `calleesOfBlocks` exactly — same shape, same swallow-on-error contract.
     */
    private calleeIdsOfBlocks;
    /**
     * Delegates the PDG impact engine to `pdg-impact.ts`.
     *
     * The private method remains as the LocalBackend dispatch seam so existing
     * tests can keep asserting that `mode:'pdg'` routes through the PDG
     * statement engine before LocalBackend attaches interprocedural symbol reach.
     * The traversal/projection/result assembly lives in the extracted helper
     * module.
     */
    private _runImpactPDG;
    /**
     * #1858 — epistemic lower-bound detection.
     *
     * impact()/context() traverse only edges materialized in the graph. When the
     * queried symbol sits on an interface / abstract boundary, callers that bind
     * to the interface via DI, a container, or dynamic dispatch — rather than
     * naming the concrete symbol — are not traced. The reported count is then a
     * lower bound, not an exact figure. Instead of returning a confident count
     * that silently omits those callers, annotate the result with
     * `epistemic: 'lower-bound'` plus a human-readable boundary note. A fully
     * resolved leaf with no indirection stays `epistemic: 'exact'`.
     *
     * Aligns with the numeric confidence model rather than the long-deleted
     * TIER_CONFIDENCE enum: the heritage/indirection edges this keys on
     * (IMPLEMENTS / METHOD_IMPLEMENTS / EXTENDS) carry the 0.85
     * `IMPACT_RELATION_CONFIDENCE` floor — "statically verifiable, but the
     * concrete binding past it is not".
     *
     * Never throws: on query error it returns 'exact', so it can only add signal,
     * never suppress a result.
     */
    /**
     * Fields the analyzer declined to link because every definition of the name
     * lives in another language (R3-1), keyed by name.
     *
     * Cached per index version. `ensureInitialized` deliberately avoids a
     * per-call `loadMeta` because every tool call routes through it; this is one
     * small read per (index, indexedAt), which re-reads exactly when a re-analyze
     * could have changed the answer and never otherwise.
     */
    private readonly crossLanguagePropertyCache;
    private crossLanguagePropertiesFor;
    private computeEpistemicBoundary;
    /** Declaring types of a method, for matching against a candidate-keyed
     *  record. One hop, asked only for methods, and only when a record exists to
     *  match against. */
    private owningTypeNames;
    /**
     * Shared BFS traversal for impact analysis (name-resolved or UID-resolved symbol).
     */
    private _runImpactBFS;
    /**
     * UID-based impact for cross-repo fan-out. Same result shape as `impact`.
     * Returns null if the repo is unknown, the UID is missing, or analysis fails.
     */
    impactByUid(repoId: string, uid: string, direction: string, opts: {
        maxDepth: number;
        relationTypes: string[];
        minConfidence: number;
        includeTests: boolean;
        signal?: AbortSignal;
    }): Promise<any | null>;
    private handleGroupTool;
    /**
     * Dispatch impact/query/context when `repo` is `@groupName` or `@groupName/memberPath`
     * (group mode — not the global indexed-repo `repo` parameter).
     */
    private callToolAtGroupRepo;
    private groupList;
    private groupSync;
    /**
     * MCP resource body for `gitnexus://group/{name}/contracts` (Issue #794).
     */
    readGroupContractsResource(groupName: string, filter: {
        type?: string;
        repo?: string;
        unmatchedOnly?: boolean;
    }): Promise<string>;
    /**
     * MCP resource body for `gitnexus://group/{name}/status` (Issue #794).
     */
    readGroupStatusResource(groupName: string): Promise<string>;
    private static formatGroupResourcePayload;
    /**
     * Fetch Route nodes with their consumers in a single query.
     * Shared by routeMap and shapeCheck to avoid N+1 query patterns.
     */
    private fetchRoutesWithConsumers;
    /**
     * Batch-fetch execution flows linked to a set of Route or Tool nodes.
     * Single query instead of N+1.
     */
    private fetchLinkedFlowsBatch;
    private routeMap;
    private shapeCheck;
    private toolMap;
    private apiImpact;
    /**
     * Query clusters (communities) directly from graph.
     * Used by getClustersResource — avoids legacy overview() dispatch.
     */
    queryClusters(repoName?: string, limit?: number): Promise<{
        clusters: any[];
    }>;
    /**
     * Query processes directly from graph.
     * Used by getProcessesResource — avoids legacy overview() dispatch.
     */
    queryProcesses(repoName?: string, limit?: number): Promise<{
        processes: any[];
    }>;
    /**
     * Query cluster detail (members) directly from graph.
     * Used by getClusterDetailResource.
     */
    queryClusterDetail(name: string, repoName?: string): Promise<any>;
    /**
     * Query process detail (steps) directly from graph.
     * Used by getProcessDetailResource.
     */
    queryProcessDetail(name: string, repoName?: string): Promise<any>;
    disconnect(): Promise<void>;
}
export {};
