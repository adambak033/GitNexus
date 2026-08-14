/**
 * Repository Manager
 *
 * Manages GitNexus index storage:
 * - Per-repo metadata file (gitnexus.json) under .gitnexus/, dual-written to a
 *   legacy meta.json mirror for backward compatibility (see MIGRATION.md)
 * - .gitnexus/ directory for local metadata and caches (parse-cache, parsedfile-store)
 * - Global registry at ~/.gitnexus/registry.json for MCP server discovery
 *
 * gitnexus.json is simply a filename distinct from the generic meta.json — it
 * has no bearing on git worktree behavior. .gitnexus/ remains fully git-ignored
 * in every case; each worktree already has its own independent .gitnexus/ by
 * construction (getStoragePath is per-checkout), regardless of which filename
 * the metadata inside it uses.
 */
import { branchSlug, resolveBranchPlacement, type BranchSummary } from './branch-index.js';
import { INDEX_METADATA_FILE, getStoragePath, isMissingFilesystemError, loadMeta, type AnalyzerRunnerIdentity, type RepoMeta } from './repo-meta.js';
export { branchSlug, resolveBranchPlacement };
export type { BranchSummary };
export { getStoragePath, INDEX_METADATA_FILE, isMissingFilesystemError, loadMeta };
export type { AnalyzerRunnerIdentity, RepoMeta };
/**
 * Normalise a repo path for registry comparison across platforms
 * (#664 review feedback from @evander-wang).
 *
 * Why this exists: `path.resolve` alone is NOT enough for
 * cross-platform registry stability.
 *   - **macOS**: tmpdirs and `/var` are symlinks to `/private/var`.
 *     A child process that stored `/private/var/folders/.../repo` in
 *     the registry cannot later be matched by an outer caller that
 *     supplies the symlink form `/var/folders/.../repo`. `path.resolve`
 *     does not follow symlinks; `realpathSync.native` does.
 *   - **Windows**: GitHub runners surface tmpdirs in 8.3 short-name
 *     form (`RUNNERA~1\...`), but `process.cwd()` often returns the
 *     long form (`runneradmin\...`). `realpathSync.native` normalises
 *     both sides to the long-name canonical path.
 *   - **Windows, extended-length paths** (#2667): a caller can supply a
 *     `\\?\`-prefixed path — the usual MAX_PATH workaround — and
 *     `path.resolve` preserves the prefix, so the string compare below
 *     never matches the un-prefixed entry the registry stores. The
 *     realpath branch already dropped it (libuv strips the prefix inside
 *     `fs__realpath`), but the fallback branch did not, which is exactly
 *     the branch a missing path takes. `stripWindowsLongPathPrefix` is
 *     applied to both so the two branches agree.
 *
 * This normalisation is safe here precisely because the result is only ever
 * compared, never opened: Node does NOT re-add `\\?\` for over-MAX_PATH
 * paths, so an fs-facing path must keep whatever form the caller gave it.
 * See the `registerRepo` comment on applying canonicalisation at COMPARE
 * points only.
 *
 * Fallback behaviour: if the path does not exist on disk (e.g. a user
 * passed `gitnexus remove some-alias` and the alias misses every
 * registry entry, or the caller is resolving a path that was deleted
 * after registration), we return `path.resolve(p)` rather than
 * throwing. This preserves the idempotent-on-missing semantics of
 * `resolveRegistryEntry` / `remove`.
 *
 * Backwards compatibility: this function is applied to BOTH the
 * caller-supplied input AND each stored `entry.path` at compare time
 * inside `resolveRegistryEntry`, so registries written by older
 * versions still match correctly. Entries are NOT canonicalised at
 * write time — `registerRepo` stores `path.resolve(repoPath)` — which
 * is what makes the compare-only rule above hold.
 */
export declare const canonicalizePath: (p: string) => string;
/**
 * Compare two already-canonicalised registry paths. Case-insensitive on Windows
 * (its filesystem is), case-sensitive elsewhere. Both arguments must already be
 * run through {@link canonicalizePath}; this is the single comparison the registry
 * lookups/dedup/finalize checks all share so they answer identically.
 */
export declare const registryPathEquals: (a: string, b: string) => boolean;
/**
 * Does the clone dir derived from an entry's *name* actually belong to that
 * entry? Registry names are not unique across storage locations: a cloned
 * repo under `~/.gitnexus/repos/<name>` and a local repo registered under the
 * same name share a `getCloneDir(entry.name)` result. The server's delete
 * handler must therefore never remove the clone dir based on the name alone —
 * only when the entry's own `path` resolves to that dir (mirroring its step-2b
 * rule that cleanup is driven off `entry.path`, so a same-named sibling's
 * clone is never removed). Both sides are canonicalised so symlinked or
 * differently-spelled forms of the same dir still match.
 */
export declare const cloneDirBelongsToEntry: (cloneDir: string, entryPath: string) => boolean;
export interface IndexedRepo {
    repoPath: string;
    storagePath: string;
    lbugPath: string;
    metaPath: string;
    meta: RepoMeta;
}
/**
 * Shape of an entry in the global registry (~/.gitnexus/registry.json)
 */
export interface RegistryEntry {
    name: string;
    path: string;
    storagePath: string;
    indexedAt: string;
    lastCommit: string;
    /** See {@link RepoMeta.remoteUrl}. Mirrored from meta at register time. */
    remoteUrl?: string;
    stats?: RepoMeta['stats'];
    /**
     * Branch name owning the flat/primary index (#2106). Mirrors the flat
     * `meta.branch`. Absent for legacy single-branch entries and non-git repos —
     * additive and backward compatible.
     */
    branch?: string;
    /**
     * Non-primary branch indexes for this same path (#2106). Absent when only the
     * primary branch is indexed, preserving the one-entry-per-path model and the
     * legacy registry shape.
     */
    branches?: BranchSummary[];
}
/**
 * Get paths to key storage files.
 *
 * `storagePath` is ALWAYS the flat `<repo>/.gitnexus` — content-addressed
 * caches (`parse-cache/`, `parsedfile-store/`) live there and are shared
 * across branches (#2106 KTD7). When `branch` is provided, both `lbugPath`
 * and `metaPath` are scoped under `branches/<slug>/`. For the flat call
 * (no `branch`), `storagePath` and `lbugPath` remain byte-identical to the
 * pre-multi-branch behavior (#2106); `metaPath`'s FILENAME changed from
 * `meta.json` to `gitnexus.json` (PR #2363) — `saveMeta` keeps a `meta.json`
 * mirror in sync for consumers that still read the legacy name.
 *
 * Each branch slot has its own metadata file:
 * - Primary/flat: <repo>/.gitnexus/gitnexus.json
 * - Feature branches: <repo>/.gitnexus/branches/<slug>/gitnexus.json
 *
 * Callers should use `loadMeta(metaDir)` and `saveMeta(metaDir, meta)` where
 * metaDir is the directory containing the metadata file — both handle the
 * legacy mirror automatically.
 */
export declare const getStoragePaths: (repoPath: string, branch?: string) => {
    storagePath: string;
    lbugPath: string;
    metaPath: string;
};
/**
 * Check whether a KuzuDB index exists in the given storage path.
 * Non-destructive — safe to call from status commands.
 */
export declare const hasKuzuIndex: (storagePath: string) => Promise<boolean>;
/**
 * Clean up stale KuzuDB files after migration to LadybugDB.
 *
 * Returns:
 *   found        — true if .gitnexus/kuzu existed and was deleted
 *   needsReindex — true if kuzu existed but lbug does not (re-analyze required)
 *
 * Callers own the user-facing messaging; this function only deletes files.
 */
export declare const cleanupOldKuzuFiles: (storagePath: string) => Promise<{
    found: boolean;
    needsReindex: boolean;
}>;
/**
 * Save metadata to the metadata file (gitnexus.json) in the given directory,
 * dual-writing the legacy `meta.json` mirror for backward compatibility.
 *
 * Atomic via tmp-file + rename (matches `saveParseCache`'s pattern). The
 * `incrementalInProgress` dirty flag travels through this file — a crash
 * mid-write would leave a corrupt `gitnexus.json` that the next run's
 * `loadMeta` would silently treat as "no prior index", losing the dirty
 * flag and skipping the recovery full-rebuild. Write-and-rename rules
 * that out: the rename is atomic on POSIX and on Windows (`fs.rename`
 * on `node:fs/promises` uses `MoveFileEx(REPLACE_EXISTING)`), so either
 * the old or the new file is observed at every moment.
 *
 * `gitnexus.json` is the primary write and must succeed. `meta.json` is a
 * best-effort mirror kept for consumers that only know the legacy filename
 * (see MIGRATION.md) — its write failure is logged, not thrown, so a
 * mirror-write hiccup never fails the caller's analyze run.
 */
export declare const saveMeta: (metaDir: string, meta: RepoMeta) => Promise<void>;
/**
 * Check if a path has a GitNexus index (metadata file or legacy location)
 */
export declare const hasIndex: (repoPath: string) => Promise<boolean>;
/**
 * Load an indexed repo from a path (checks metadata file first, then legacy)
 */
export declare const loadRepo: (repoPath: string) => Promise<IndexedRepo | null>;
/**
 * Reconcile the metadata files for a repo's flat slot and every
 * `branches/<slug>/` slot. Runs once per `analyze` (see run-analyze.ts).
 *
 * This is a best-effort compatibility sync, NOT a one-way migration: the
 * legacy `meta.json` mirror is kept in sync indefinitely (removal happens at
 * a future major version — see MIGRATION.md), so older binaries, still-running
 * MCP servers, and the shipped editor hooks keep working, and a rollback to a
 * pre-rename version sees current metadata instead of "no prior index".
 * Returns true when any file was written.
 */
export declare const reconcileMetadataFiles: (repoPath: string) => Promise<boolean>;
/**
 * Find .gitnexus by walking up from a starting path
 */
export declare const findRepo: (startPath: string) => Promise<IndexedRepo | null>;
export declare function isReadOnlyFilesystemError(err: unknown): boolean;
/**
 * Keep .gitnexus/ ignored. It contains local index state and caches.
 */
export declare const ensureGitNexusIgnored: (repoPath: string) => Promise<void>;
/**
 * Get the path to the global GitNexus directory
 */
export declare const getGlobalDir: () => string;
/**
 * Get the path to the global registry file
 */
export declare const getGlobalRegistryPath: () => string;
/**
 * Read the global registry. Returns empty array if not found.
 */
export declare const readRegistry: () => Promise<RegistryEntry[]>;
/**
 * Options for {@link registerRepo}. All optional — callers without any
 * disambiguation requirement can keep calling `registerRepo(path, meta)`
 * unchanged.
 */
export interface RegisterRepoOptions {
    /**
     * User-provided alias from `analyze --name <alias>` (#829). Overrides
     * the default basename-derived registry `name`. Persisted — subsequent
     * re-analyses of the same path without `--name` preserve the alias.
     */
    name?: string;
    /**
     * Allow two DIFFERENT repo paths to register under the same alias
     * (#829). Mapped from the `--allow-duplicate-name` CLI flag.
     *
     * Scope: this flag governs cross-path alias sharing only — one repo
     * path always has exactly one registry entry (and therefore exactly
     * one alias). Re-analyzing the same path with `--name Y` overwrites
     * a previous `--name X`; it does NOT create a second entry or a
     * second alias for the same path (see the upsert-by-resolved-path
     * logic in {@link registerRepo} and the
     * `re-registerRepo with a different name overrides the previous
     * alias` test in `test/unit/repo-manager.test.ts`).
     *
     * Distinct from `--force` (which only triggers pipeline re-index);
     * a user accepting a duplicate alias should not be forced to also
     * re-run the full pipeline.
     */
    allowDuplicateName?: boolean;
    /**
     * Non-primary branch this run indexed (#2106). When set, the branch's
     * summary is upserted into the entry's `branches[]` and the primary
     * top-level fields are left untouched. When `undefined`, this is a
     * primary/flat run that refreshes the top-level fields (and preserves any
     * existing branch summaries).
     */
    branch?: string;
}
/**
 * Thrown by {@link registerRepo} when a requested name is already in
 * use by a DIFFERENT path. The CLI layer surfaces this as an actionable
 * error instead of relying on `.message` string-matching.
 *
 * The colliding alias is exposed as `err.registryName` (not `err.name`).
 * `err.name` keeps its inherited `Error.prototype.name` semantics (the
 * class name) so downstream code can do the usual `err.name ===
 * 'RegistryNameCollisionError'` checks; use the `kind` discriminant or
 * `instanceof RegistryNameCollisionError` for type-safe narrowing.
 */
export declare class RegistryNameCollisionError extends Error {
    readonly registryName: string;
    readonly existingPath: string;
    readonly requestedPath: string;
    readonly kind: "RegistryNameCollisionError";
    constructor(registryName: string, existingPath: string, requestedPath: string);
}
export declare const registerRepo: (repoPath: string, meta: RepoMeta, opts?: RegisterRepoOptions) => Promise<string>;
export declare const unregisterRepo: (repoPath: string) => Promise<void>;
export declare const removeBranchIndex: (repoPath: string, branch: string) => Promise<boolean>;
/**
 * Record that the flat workspace slot now serves `branch` (#2354).
 *
 * The flat index follows the checked-out working tree, so when a plain
 * analyze lands on a branch that also has a pinned `branches/<slug>/`
 * sub-index, that sub-index becomes permanently shadowed — explicit
 * `--branch` runs re-resolve to the flat slot and query-side branch scoping
 * serves the flat handle first. Delete the shadowed directory and drop its
 * registry summary in the same pass (leaving either half behind would strand
 * un-cleanable disk bloat), and refresh the entry's top-level `branch` label
 * so `list`/`list_repos`/branch-scoped queries stay coherent.
 *
 * Deliberately narrow for the analyze fast path: a missing registry entry is
 * a no-op — including the sub-index deletion, which only runs for registered
 * repos (never self-heals an unregistered repo, per #2264/#1169; the registry
 * check precedes the rm per #2364 review F2) — and no subprocess is spawned.
 *
 * Only the closing re-read/mutate/write runs under the registry lock. The
 * recursive `rm` stays outside it — mirroring `clean.ts`, which deletes the
 * branch directory before calling the (locked) `removeBranchIndex` — so a slow
 * delete (large sub-index, AV scan, network mount) never blocks every other
 * registry operation on the machine.
 */
export declare const adoptFlatBranchLabel: (repoPath: string, branch: string) => Promise<void>;
/**
 * Thrown by {@link resolveRegistryEntry} when no registered repo matches
 * the caller's target string (by alias, basename, remote-inferred name,
 * or resolved path). CLI callers that want idempotent "remove" semantics
 * should catch this and exit 0 with a warning; non-idempotent callers
 * (e.g. MCP tools) can surface the error directly.
 */
export declare class RegistryNotFoundError extends Error {
    readonly target: string;
    readonly availableNames: string[];
    readonly kind: "RegistryNotFoundError";
    constructor(target: string, availableNames: string[]);
}
/**
 * Thrown by {@link resolveRegistryEntry} when the target string matches
 * the `name` of two or more entries — only possible when the user
 * previously registered duplicates via `analyze --name X
 * --allow-duplicate-name` (#829). The error carries enough information
 * for the caller to render an actionable disambiguation hint without
 * string-matching on `.message`.
 *
 * `kind` is a string literal discriminant (same pattern as
 * {@link RegistryNameCollisionError}) so callers can narrow via
 * `err.kind === 'RegistryAmbiguousTargetError'` without importing the
 * class.
 */
export declare class RegistryAmbiguousTargetError extends Error {
    readonly target: string;
    readonly matches: RegistryEntry[];
    readonly kind: "RegistryAmbiguousTargetError";
    constructor(target: string, matches: RegistryEntry[]);
}
/**
 * Thrown by {@link assertAnalysisFinalized} when a successful `analyze`
 * run did not actually persist the index metadata file or did not register
 * the repo in `~/.gitnexus/registry.json` (#1169).
 *
 * Why this exists: on Windows, `gitnexus analyze` has been observed to
 * exit cleanly (code 0) with `lbug.wal` written but no metadata file,
 * leaving the repo invisible to `gitnexus list`/`status` and downstream
 * MCP discovery. The only signal to the user was an empty banner —
 * which is indistinguishable from a no-op early return. This invariant
 * fails loudly with an actionable diagnostic so the silent-finalize bug
 * surfaces with a non-zero exit code and a recoverable error message
 * regardless of the upstream root cause (re-exec churn, native module
 * side effects, antivirus, or future regressions).
 */
export declare class AnalysisNotFinalizedError extends Error {
    readonly repoPath: string;
    readonly storagePath: string;
    readonly missing: 'meta' | 'registry-entry';
    readonly registryPath: string;
    readonly kind: "AnalysisNotFinalizedError";
    constructor(repoPath: string, storagePath: string, missing: 'meta' | 'registry-entry', registryPath: string);
}
/**
 * True when the global registry already contains an entry whose canonical path
 * matches `repoPath`. Uses the same canonical, case-folded (Windows) comparison
 * as {@link assertAnalysisFinalized} so "is it registered?" answers identically
 * at the analyze fast-path gate and at the finalize assertion. Pure read.
 */
export declare const isRepoRegistered: (repoPath: string) => Promise<boolean>;
/**
 * Verify that a successful `analyze` call actually produced an indexed,
 * registered repo on disk. Two checks, both strictly required:
 *
 *   1. `gitnexus.json` must exist at `<repoPath>/.gitnexus/gitnexus.json`
 *      (the primary metadata file; the legacy `meta.json` mirror is not
 *      sufficient — a finalized analyze always writes the primary).
 *   2. The global registry (`getGlobalRegistryPath()`) must contain an
 *      entry whose canonical path matches `repoPath`.
 *
 * Throws {@link AnalysisNotFinalizedError} on the first failure with the
 * specific missing artifact. Pure read — does not mutate disk state.
 *
 * Callers must skip this assertion on the `alreadyUpToDate` early-return
 * path, where the rebuild was deliberately not run.
 */
export declare const assertAnalysisFinalized: (repoPath: string) => Promise<void>;
/**
 * Thrown by {@link assertSafeStoragePath} when a registry entry's
 * `storagePath` does NOT point at the expected `<entry.path>/.gitnexus`
 * subfolder. CLI destructive commands (`remove`, `clean --all`) should
 * catch this and exit non-zero without deleting anything — the usual
 * cause is a corrupted or hand-edited `~/.gitnexus/registry.json`, and
 * proceeding would mean `fs.rm(recursive: true)` on whatever odd path
 * the entry is pointing at.
 */
export declare class UnsafeStoragePathError extends Error {
    readonly entry: RegistryEntry;
    readonly expectedStoragePath: string;
    readonly actualStoragePath: string;
    readonly kind: "UnsafeStoragePathError";
    constructor(entry: RegistryEntry, expectedStoragePath: string, actualStoragePath: string);
}
/**
 * Guard rail for destructive CLI paths (`remove` #664,
 * `clean --all` #258, future MCP `remove` tool): verify that a
 * registry entry's `storagePath` is the canonical `<repo>/.gitnexus`
 * subfolder of its `path`. If not, throw {@link UnsafeStoragePathError}
 * so the caller exits without touching disk.
 *
 * Why this exists (#1003 review — @magyargergo):
 *   - `~/.gitnexus/registry.json` is a plain-text user-writable file.
 *     A corrupted, hand-edited, or downgrade/upgrade-racing entry
 *     could plausibly end up with `storagePath === ""` (resolves to
 *     cwd), `storagePath === path` (the repo root!), `storagePath`
 *     equal to a parent/sibling of the repo, or simply any arbitrary
 *     filesystem path.
 *   - `fs.rm(recursive: true, force: true)` on ANY of those would be
 *     a runtime disaster — at best delete the user's working tree, at
 *     worst nuke an unrelated directory tree they happen to own.
 *   - `clean` (default, cwd-scoped) is safe by construction — it
 *     re-derives storagePath from `findRepo(cwd)` and never trusts
 *     the registry field. But `clean --all` DOES iterate the registry
 *     and trust each entry's stored storagePath (same shape as
 *     `remove`), so this helper must be wired into that loop too.
 *   - `server/api.ts` recomputes storagePath from `getStoragePath(entry.path)`
 *     and so is likewise safe-by-construction.
 *
 * Pure string check — does NOT require the paths to exist on disk.
 * Windows: case-insensitive; POSIX: case-sensitive. Matches the
 * comparison shape used elsewhere in this module.
 */
export declare const assertSafeStoragePath: (entry: RegistryEntry) => void;
/**
 * Resolve a user-supplied target string (from `gitnexus remove <target>`
 * or equivalent MCP tool argument) to a single registry entry.
 *
 * Match precedence (first hit wins, subsequent tiers are only tried if
 * the prior tier produces zero matches):
 *   1. Exact resolved-path match (Windows: case-insensitive).
 *      Paths are unique by registry construction, so a path match can
 *      never be ambiguous.
 *   2. Exact `name` match (case-insensitive). If ≥ 2 entries share the
 *      name — only possible via `--allow-duplicate-name` (#829) —
 *      throws {@link RegistryAmbiguousTargetError}.
 *
 * No fuzzy / partial matching — unambiguous, scriptable behaviour is
 * more important than convenience for destructive commands.
 *
 * Throws {@link RegistryNotFoundError} if no entry matches.
 *
 * `entries` is passed in (rather than re-read) so callers that already
 * hold the registry snapshot (e.g. to print a "before" state) can avoid
 * a second disk read, and so tests can inject fixtures without touching
 * `GITNEXUS_HOME`.
 */
export declare const resolveRegistryEntry: (entries: RegistryEntry[], target: string) => RegistryEntry;
/**
 * List all registered repos from the global registry.
 *
 * With `validate: true`, prunes only entries whose metadata is *provably* gone
 * (fs.access on both gitnexus.json and legacy meta.json fails with ENOENT or
 * ENOTDIR) and persists the result on a best-effort basis: the pruned view is
 * always returned, even when the write fails. Entries that are merely "not provably
 * absent" — any other fs.access failure (EIO/EAGAIN/EBUSY/EACCES, etc.) — are
 * KEPT, so a transient I/O storm cannot wipe the registry. A kept entry is
 * therefore "not confirmed present," not "confirmed present"; downstream DB
 * opens are independently and lazily guarded.
 */
export declare const listRegisteredRepos: (opts?: {
    validate?: boolean;
}) => Promise<RegistryEntry[]>;
export interface CLIConfig {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    provider?: 'openai' | 'openrouter' | 'azure' | 'custom' | 'cursor' | 'claude' | 'codex' | 'opencode' | 'minimax';
    cursorModel?: string;
    claudeModel?: string;
    codexModel?: string;
    opencodeModel?: string;
    /** Azure api-version query param (e.g. '2024-10-21'). Only used when provider is 'azure'. */
    apiVersion?: string;
    /** Set true when the deployment is a reasoning model (o1, o3, o4-mini). Auto-detected for OpenAI; must be set for Azure deployments. */
    isReasoningModel?: boolean;
}
/**
 * Get the path to the global CLI config file
 */
export declare const getGlobalConfigPath: () => string;
/**
 * Load CLI config from ~/.gitnexus/config.json
 */
export declare const loadCLIConfig: () => Promise<CLIConfig>;
/**
 * Save CLI config to ~/.gitnexus/config.json
 */
export declare const saveCLIConfig: (config: CLIConfig) => Promise<void>;
/**
 * Find other registered entries whose `remoteUrl` matches the given
 * one, excluding `selfPath` (case-insensitive on Windows). Entries
 * without a `remoteUrl` are ignored — we cannot prove sibling-ness
 * without a fingerprint.
 */
export declare const findSiblingClones: (remoteUrl: string | undefined, selfPath: string) => Promise<RegistryEntry[]>;
/**
 * Description of how a working directory relates to a registered index.
 *
 * `match` semantics:
 *   - `path`              — `cwd` is inside the registered entry's path.
 *   - `sibling-by-remote` — `cwd` is in a different on-disk clone of the
 *                           same repo (same `remoteUrl`).
 *   - `none`              — no relationship found.
 */
export interface CwdMatch {
    match: 'path' | 'sibling-by-remote' | 'none';
    entry?: RegistryEntry;
    /** The git toplevel of `cwd`, when `cwd` is inside a git work tree. */
    cwdGitRoot?: string;
    /** HEAD of the cwd's clone, when resolvable. */
    cwdHead?: string;
    /**
     * Number of commits the registered `lastCommit` is behind the
     * sibling-clone HEAD, when both refs are known to the cwd's clone.
     * `undefined` when the comparison cannot be performed (e.g. the
     * indexed commit isn't reachable from cwd).
     */
    drift?: number;
    /** Human-readable hint, set whenever the situation warrants warning. */
    hint?: string;
}
