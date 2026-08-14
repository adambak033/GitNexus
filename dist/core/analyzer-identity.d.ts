/**
 * Reproducible analyzer identity stamped into RepoMeta after a successful run.
 *
 * Schema v4 uses length-prefixed canonical frames. Build files and runtime
 * artifacts contribute SHA-256 payload digests, so a validated stat inventory
 * can safely reuse those expensive per-file digests across short-lived CLI and
 * server-worker processes. The cache is only an optimization: malformed,
 * mismatched, or missing entries are rehashed, and every identity calculation
 * performs a final return-boundary inventory before returning.
 *
 * `invokedArtifact` remains in the receipt for diagnostics, but is deliberately
 * excluded from semantic freshness. The CLI and the server analyze worker are
 * different entry files inside the same build tree; alternating between them
 * must not make an otherwise identical index stale.
 */
import path from 'node:path';
import type { AnalyzerRunnerIdentity } from '../storage/repo-manager.js';
export declare const ANALYZER_RUNNER_IDENTITY_SCHEMA_VERSION: 4;
export interface AnalyzerIdentityTraversalLimits {
    buildEntries: number;
    buildDepth: number;
    buildBytes: number;
    runtimePackages: number;
    runtimeEdges: number;
    runtimeEntries: number;
    runtimeDepth: number;
    runtimePayloads: number;
    runtimeBytes: number;
    resolutionAncestors: number;
}
export interface AnalyzerIdentityResolveOptions {
    /** Override the persistent digest-cache directory (primarily for tests). */
    cacheDirectory?: string;
    /** Tighten traversal limits for constrained hosts/tests; never raises production bounds. */
    traversalLimits?: Partial<AnalyzerIdentityTraversalLimits>;
    /** Observe actual file payload reads; cache hits do not invoke this callback. */
    onHashedInput?: (input: {
        kind: 'build' | 'runtime-artifact';
        path: string;
        bytes: number;
    }) => void;
    /** Observe cold-path topology work; a complete cache hit emits nothing. */
    onCacheMissWork?: (input: {
        kind: 'directory-walk' | 'manifest-read';
        path: string;
    }) => void;
    /** Observe complete return-boundary cache validations (primarily for tests). */
    onCacheValidationPass?: (input: {
        guardCount: number;
    }) => void;
}
/**
 * Case-stabilize a path's Windows drive letter so two processes that observed
 * the same directory under different drive-letter casing (`c:\…` vs `C:\…`)
 * produce byte-identical analyzer-identity path fields (#2668).
 *
 * `realpathSync.native` canonicalizes 8.3 short names and symlinks but does not
 * guarantee the drive-letter case it returns — it can preserve whatever casing
 * the caller's path carried, and `import.meta.url` casing depends on how each
 * entry process (CLI shim vs `npx`/npm wrapper vs server worker) was launched.
 * When `analyze` stamps `build.rootPath` under one casing and `status`
 * recomputes it under another, `analyzerRunnerIdentitiesEqual` deep-compares
 * unequal and `status` reports a freshly-analyzed, untouched repo as stale.
 * Uppercasing the drive letter (drive letters are case-insensitive; uppercase
 * is the conventional form) collapses that variance. POSIX paths are returned
 * unchanged. `platform` is explicit so the transform is unit-testable off
 * Windows.
 *
 * The optional `\\?\` extended-length prefix is preserved and the drive letter
 * after it is still normalized; UNC paths (`\\server\share`, `\\?\UNC\...`)
 * have no drive letter and are left untouched.
 *
 * That optional group is defensive, not a case `realpathSync.native` produces:
 * libuv's `fs__realpath_handle` strips `\\?\` (and rewrites `\\?\UNC\` back to
 * `\\`) before returning, so the prefix can only reach here from caller-supplied
 * input, which `path.resolve` preserves (#2667).
 *
 * Preserving it is load-bearing. The roots this normalizes are not just compared —
 * they are READ FROM: `resolveBuildRoot` joins `package.json` onto `packageRoot`,
 * `collectBuildEntries` walks `buildRoot`, and the lockfile lookup walks
 * `packageRoot`'s ancestors. Node does not re-add `\\?\` for over-MAX_PATH paths,
 * so stripping here would break analyzer-identity resolution on a deep checkout
 * exactly as it would at any other filesystem boundary. (These fields are also
 * compared between an `analyze` and a later `status` run, so a shape change would
 * additionally risk the #2668 false-stale class — but the filesystem reads are the
 * reason that matters.)
 *
 * Registry-style path COMPARISON is a different domain, never opens what it
 * canonicalizes, and does normalize the prefix away: see
 * `stripWindowsLongPathPrefix` in `src/lib/utils.ts` and its use in
 * `canonicalizePath`.
 */
export declare function normalizeAnalyzerRootPath(p: string, platform: NodeJS.Platform): string;
/**
 * Whether `candidate` is `parent` itself or lives beneath it.
 *
 * The absolute-result rejection is load-bearing on Windows: `path.relative`
 * cannot express a relative path between two different drives, so it returns the
 * absolute target instead — `path.win32.relative('C:\\parent', 'D:\\other')` is
 * `'D:\\other'`. That string does not start with `..`, so the `..` checks alone
 * would report an unrelated drive as *inside* the parent. This mirrors the
 * containment guards elsewhere in the repo (`server/api.ts`,
 * `server/git-clone.ts`, `group/extractors/fs-utils.ts`), which all pair the
 * `..` check with `path.isAbsolute`.
 *
 * `pathApi` is injectable so the win32 semantics are unit-testable from a POSIX
 * runner; production callers always use the platform-bound `path`.
 */
declare function isInside(parent: string, candidate: string, pathApi?: typeof path): boolean;
/** Test seam for {@link isInside} (see `_hashAnalyzerIdentityFramesForTests`). */
export declare const _isInsideForTests: typeof isInside;
/**
 * Whether a REALPATH'd package root lives inside some installed dependency
 * tree. Used as the resolved-location half of "is this dependency a checkout
 * this repository owns?" (see {@link undeclaredLocalDevDependencyNames}).
 *
 * The input must already be realpath'd: `resolveDependencyPackageRoot` returns
 * `realpathSync.native`, so a package reached through a link out of
 * `node_modules` reports its checkout location and a package that merely lives
 * in `node_modules` reports a path that still carries the segment.
 *
 * `pathApi` is injectable so the Windows separator handling is unit-testable
 * from a POSIX runner, exactly as {@link isInside} does. The separator sets
 * differ deliberately: `\` is a legal filename character on POSIX, so only
 * win32 may treat it as a boundary.
 */
declare function hasNodeModulesSegment(candidate: string, pathApi?: typeof path): boolean;
/** Test seam for {@link hasNodeModulesSegment} (see {@link _isInsideForTests}). */
export declare const _hasNodeModulesSegmentForTests: typeof hasNodeModulesSegment;
export type AnalyzerRunnerSemanticIdentity = Omit<AnalyzerRunnerIdentity, 'invokedArtifact'>;
/**
 * Normalize a raw diagnostic receipt for freshness comparison. The entrypoint
 * is the only excluded field; malformed/legacy receipts never compare equal.
 */
export declare function normalizeAnalyzerRunnerIdentityForComparison(identity: unknown): AnalyzerRunnerSemanticIdentity | null;
/** Resolve the identity of the analyzer build and runtime executing now. */
export declare function resolveAnalyzerRunnerIdentity(analyzerModuleUrl: string, options?: AnalyzerIdentityResolveOptions): AnalyzerRunnerIdentity;
/**
 * Semantic freshness comparison. Both receipts must be well-formed schema-v4
 * values; only the diagnostic entrypoint field is normalized away.
 */
export declare function analyzerRunnerIdentitiesEqual(indexedIdentity: unknown, currentIdentity: unknown): boolean;
/**
 * Capture analyzer identity before invoking a loader that may evaluate the
 * analyzer module graph. The explicit receipt is then threaded into analysis
 * and checked again immediately before metadata commit.
 */
export declare function captureAnalyzerIdentityBeforeLoad<T>(analyzerModuleUrl: string, loader: () => Promise<T>, options?: AnalyzerIdentityResolveOptions): Promise<{
    runnerIdentity: AnalyzerRunnerIdentity;
    loaded: T;
}>;
/** Re-resolve immediately before commit and reject analyzer mutation mid-run. */
export declare function finalizeAnalyzerRunnerIdentity(analyzerModuleUrl: string, startedWith: AnalyzerRunnerIdentity, options?: AnalyzerIdentityResolveOptions): AnalyzerRunnerIdentity;
export {};
