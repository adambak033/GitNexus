/**
 * Git working tree vs index commit staleness (used by MCP resources, group status, etc.).
 * Lives in core/ so application code does not depend on the MCP package layer.
 */
import { type CwdMatch } from '../storage/repo-manager.js';
export interface StalenessInfo {
    isStale: boolean;
    commitsBehind: number;
    hint?: string;
}
/**
 * Check how many commits the index is behind HEAD (synchronous; uses git CLI).
 */
export declare function checkStaleness(repoPath: string, lastCommit: string): StalenessInfo;
/**
 * Async variant of {@link checkStaleness} — spawns git as a child process
 * instead of blocking the event loop.  Used by `listRepos()` to check many
 * repos in parallel (issue #1363: 200 repos × sync spawn ≈ 50 s).
 */
export declare function checkStalenessAsync(repoPath: string, lastCommit: string): Promise<StalenessInfo>;
/**
 * Resolve a working directory against the global registry. Returns:
 *   - `match: 'path'`              when `cwd` is inside a registered entry's path
 *   - `match: 'sibling-by-remote'` when `cwd` lives in a different on-disk clone
 *                                   of the same repo (same `remoteUrl`)
 *   - `match: 'none'`              when neither match applies
 *
 * For sibling-by-remote matches, the caller's HEAD and the drift vs the
 * indexed `lastCommit` are also returned so the MCP layer can warn
 * before serving silently-stale answers (issue: silent graph drift
 * across sibling clones).
 *
 * `path` matches deliberately use the longest-prefix rule so a cwd
 * inside a sub-path of a registered repo still matches that repo, not
 * a coincidentally-aliased shorter entry.
 */
export declare function checkCwdMatch(cwd: string): Promise<CwdMatch>;
