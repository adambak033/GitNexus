import { type Ignore } from 'ignore';
import type { Path } from 'path-scurry';
export declare const shouldIgnorePath: (filePath: string) => boolean;
/** Check if a directory name is in the hardcoded ignore list */
export declare const isHardcodedIgnoredDirectory: (name: string) => boolean;
/**
 * Load .gitignore and .gitnexusignore rules from the repo root.
 * Returns an `ignore` instance with all patterns, or null if no files found.
 */
export interface IgnoreOptions {
    /** Skip .gitignore parsing, only read .gitnexusignore. Defaults to GITNEXUS_NO_GITIGNORE env var. */
    noGitignore?: boolean;
    /** Skip core.excludesFile and $GIT_COMMON_DIR/info/exclude. Defaults to GITNEXUS_NO_GLOBAL_IGNORE env var. */
    noGlobalIgnore?: boolean;
}
export declare const loadIgnoreRules: (repoPath: string, options?: IgnoreOptions) => Promise<Ignore | null>;
/**
 * Create a glob-compatible ignore filter combining:
 * - .gitignore / .gitnexusignore patterns (via `ignore` package)
 * - Hardcoded DEFAULT_IGNORE_LIST, IGNORED_EXTENSIONS, IGNORED_FILES
 *
 * Returns an IgnoreLike object for glob's `ignore` option,
 * enabling directory-level pruning during traversal.
 *
 * Precedence (#771): user's `.gitnexusignore` negation patterns take
 * priority over the hardcoded list, matching `.gitignore` semantics.
 * An explicit `!pattern` rule unignores descendants even when they
 * would otherwise be blocked by DEFAULT_IGNORE_LIST — UNLESS a more
 * specific rule in the same file re-ignores a subset (e.g.
 * `!__tests__/` paired with `__tests__/generated/` blocks the child
 * while leaving the parent negated). Last-match-wins is enforced by
 * consulting `ig.ignores(rel)` after `hasExplicitUnignore`.
 */
export declare const createIgnoreFilter: (repoPath: string, options?: IgnoreOptions) => Promise<{
    ignored(p: Path): boolean;
    childrenIgnored(p: Path): boolean;
}>;
