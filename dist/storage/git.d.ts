/**
 * True when the working tree has uncommitted changes that analyze would
 * re-index, even at a matching HEAD. Excludes the paths GitNexus writes during
 * analyze (.gitnexus/, .claude/, .cursor/, AGENTS.md, CLAUDE.md, and the
 * repo-local .agents/ mirror) so its own output never counts as dirty
 * (regression vs PR #1233 behavior). The entire .agents/ tree is excluded,
 * matching the .claude/ treatment, because the skill mirror writes across
 * .agents/skills/ and deeper paths. Conservative on any git failure. Shared
 * so `analyze`'s fast-path gate and `status`'s freshness report agree on what
 * "dirty" means.
 */
export declare const isWorkingTreeDirty: (repoPath: string) => boolean;
/**
 * Snapshot, per candidate file, whether it is safe for `selfCommitContextFiles`
 * to auto-commit — call this BEFORE `analyze` writes AGENTS.md/CLAUDE.md.
 * A file is safe when it does not exist yet (first-time creation, the normal
 * case) or is currently clean (`git status --porcelain` reports nothing for
 * it). A file that already has an uncommitted user edit is unsafe: without
 * this check `selfCommitContextFiles` cannot tell that edit apart from the
 * stats refresh `analyze` is about to write, and would silently sweep both
 * into one generated-looking commit. Fails closed — a git failure marks the
 * file unsafe rather than assuming it's clean. See #2639 review round 2.
 */
export declare const snapshotSelfCommitSafety: (repoPath: string, candidateFiles: string[]) => Map<string, boolean>;
/**
 * Best-effort auto-commit for the AGENTS.md/CLAUDE.md files `analyze --self-commit`
 * just (re)wrote. Filters `candidateFiles` down to the ones that actually exist
 * under `repoPath` AND were marked safe by `snapshotSelfCommitSafety` — a file
 * that already had an uncommitted edit before this run is skipped (logged),
 * never swept into the generated commit. Never `git add -A`. `git status
 * --porcelain` (not `diff --quiet`) is deliberate: a first-time `analyze` run
 * creates AGENTS.md/CLAUDE.md fresh, and untracked files never show up in
 * `git diff`, only in `git status` — the same reason `isWorkingTreeDirty`
 * above uses `--porcelain`. If `git commit` fails after `git add` already
 * staged the safe files (e.g. missing git identity), the staged files are
 * reset back to unstaged so the user's index isn't silently left mutated.
 * No-ops silently (never throws) when: none of the candidate files exist or
 * are safe, none changed, or any git step fails. Must never fail the
 * surrounding `analyze` run. See #2639.
 */
export declare const selfCommitContextFiles: (repoPath: string, candidateFiles: string[], preRunSafety: Map<string, boolean>) => void;
export declare const isGitRepo: (repoPath: string) => boolean;
export declare const getCurrentCommit: (repoPath: string) => string;
/**
 * Remove `user[:password]@` userinfo from an http(s) URL.
 *
 * `git config remote.origin.url` returns whatever was configured, and the
 * HTTPS token form `https://x-access-token:<token>@host/owner/repo` is how
 * CI checkouts and credential helpers routinely authenticate. That string
 * reached `registry.json`, the per-repo meta and the MCP `list_repos`
 * payload verbatim, which turned repository discovery into credential
 * disclosure (#2914).
 *
 * Only `http`/`https` are rewritten. `ssh://git@host/…` and the SCP-like
 * `git@host:owner/repo` carry an SSH *user name*, not a secret, and are part
 * of the remote's identity — dropping it would repoint the sibling-clone
 * fingerprint (#2054) for every already-registered repo.
 *
 * The match is bounded by the authority (`[^/]*` cannot cross the first `/`
 * after the scheme) and greedy to the last `@` in it, so a password
 * containing `@` is removed whole rather than leaving its tail behind.
 */
export declare const stripUrlCredentials: (url: string) => string;
/**
 * Get a stable canonical identifier for the repo's `origin` remote, if any.
 *
 * Used to fingerprint two on-disk clones as the same logical repository
 * (prevents silent graph drift across sibling clones — see #2054). `path` alone
 * is unreliable: worktrees, "clean clone for indexing" hygiene, and
 * multi-agent workspaces routinely have the same repo at multiple
 * absolute paths. The remote URL is the only on-disk signal that
 * survives those conventions.
 *
 * Normalisation strategy:
 *   - Strip http(s) userinfo credentials (see {@link stripUrlCredentials}).
 *     Done FIRST, before the host lower-casing below — that regex treats the
 *     whole `user:pass@host` span as the host and would mangle the secret's
 *     case on its way into the registry (#2914).
 *   - Strip a trailing `.git` so `https://x/y` and `https://x/y.git` collapse.
 *   - Strip a trailing `/` for the same reason.
 *   - `git@github.com:foo/bar` and `https://github.com/foo/bar` are
 *     intentionally NOT collapsed — they are different remotes from
 *     git's perspective and we don't want to assert equivalence.
 *   - Lower-case the host portion so `GitHub.com` and `github.com`
 *     don't desync; preserves case in path because some hosts
 *     (Bitbucket Server) treat repo paths case-sensitively.
 *
 * Returns `undefined` when there is no origin remote, the directory
 * isn't a git repo, or git itself isn't available.
 */
export declare const getRemoteUrl: (repoPath: string) => string | undefined;
/**
 * Find the git repository root from any path inside the repo
 */
export declare const getGitRoot: (fromPath: string) => string | null;
/**
 * Get the *canonical* repository root, dereferencing git worktrees.
 *
 * Unlike `getGitRoot` (which uses `git rev-parse --show-toplevel` and
 * returns the WORKTREE's root when called inside a linked worktree),
 * this uses `git rev-parse --git-common-dir` — the shared `.git`
 * directory, identical for the main checkout and every linked
 * worktree — and returns its parent.
 *
 * Why it matters (#1259): when `gitnexus analyze` runs inside a
 * worktree (e.g. `/repo/wt-feature/`), deriving `repoName` from
 * `path.basename(getGitRoot(cwd))` registers the project under the
 * worktree's directory slug (`wt-feature`) instead of the canonical
 * repo's basename (`repo`). Each worktree then re-registers as a
 * "different" project, AGENTS.md is rewritten with the wrong MCP URI,
 * and Claude-Code-style worktree workflows silently accumulate
 * duplicate registry entries.
 *
 * Returns `null` when the path is not inside a git repository or
 * `git` is not available, so callers can chain safely:
 * `getCanonicalRepoRoot(p) ?? getGitRoot(p) ?? p`.
 *
 * `--path-format=absolute` is required because `--git-common-dir`
 * returns a path *relative to cwd* by default (e.g. `../.git` when
 * called from a worktree), which would resolve to the wrong absolute
 * path if the caller later resolved it from a different directory.
 */
export declare const getCanonicalRepoRoot: (fromPath: string) => string | null;
/**
 * Path to the repo's `$GIT_COMMON_DIR/info/exclude` file — git's own
 * per-repo, untracked exclude list (same tier as `.gitignore` in
 * precedence, but never committed, so it works even when the caller has
 * no write access to the repo's tracked content). Shared across every
 * linked worktree of a repo, matching git's own resolution (#2606).
 *
 * Returns `null` when `fromPath` is not inside a git repository or `git`
 * is unavailable; callers should treat that the same as "no file".
 */
export declare const getGitInfoExcludePath: (fromPath: string) => string | null;
/**
 * Path to git's own global, all-repos ignore file: the value of
 * `core.excludesFile` (any config scope — system/global/local, resolved
 * the same way `git` itself would from `fromPath`), or git's documented
 * default of `$XDG_CONFIG_HOME/git/ignore` when unset (gitignore(5)).
 * Lowest-precedence source, mirroring git's own behavior (#2606).
 *
 * Never throws: an unset key or unavailable `git` falls through to the
 * default path, which is always computable without `git`.
 */
export declare const getCoreExcludesFilePath: (fromPath: string) => string;
/**
 * Resolve `fromPath` to the directory whose basename should drive the
 * registry name (#1259) — the *identity root*. Three outcomes:
 *
 *   1. `fromPath` IS the canonical checkout root → returns it unchanged.
 *   2. `fromPath` is a linked-worktree root (has its own `.git` entry, but
 *      `git rev-parse --git-common-dir` points at a different `.git`) →
 *      returns the canonical repo root.
 *   3. `fromPath` is anything else — an arbitrary subdir under a git repo,
 *      a non-git folder, a `--skip-git` subdir of an unrelated parent
 *      checkout — returns `fromPath` unchanged.
 *
 * Why not just use `getCanonicalRepoRoot` directly? Because `git rev-parse
 * --git-common-dir` resolves the same canonical root for ANY path inside
 * a git repo, including unrelated subdirs. Using it for registry-name
 * derivation would silently re-key a `--skip-git` subdir analyze under
 * the parent git's basename, defeating the user's `--skip-git` intent
 * (regressing the #1232/#1233 fix). The "is this path a tree root"
 * gate confines the canonical-root collapse to exactly the cases where
 * #1259 matters: main checkouts and linked worktrees.
 */
export declare const resolveRepoIdentityRoot: (fromPath: string) => string;
/**
 * Find a git root by checking only `.git` entries on the ancestor chain.
 *
 * Unlike `getGitRoot`, this does not spawn `git`, so MCP can cheaply decide
 * whether a launch cwd is a worktree before running any subprocess there.
 */
export declare const findGitRootByDotGit: (fromPath: string) => string | null;
/**
 * Check whether a directory contains a .git entry (file or folder).
 *
 * This is intentionally a simple filesystem check rather than running
 * `git rev-parse`, so it works even when git is not installed or when
 * the directory is a git-worktree root (which has a .git file, not a
 * directory).  Use `isGitRepo` for a definitive git answer.
 *
 * @param dirPath - Absolute path to the directory to inspect.
 * @returns `true` when `.git` is present, `false` otherwise.
 */
export declare const hasGitDir: (dirPath: string) => boolean;
/**
 * Read `remote.origin.url` from a git repository, or `null` if not a
 * git repo, has no `origin` remote, or git is unavailable.
 *
 * Used by the registry-name inference path (#979) to recover a
 * meaningful repo name when `path.basename(repoPath)` is generic
 * (e.g. monorepo subprojects, git worktrees, Gas-Town-style
 * `<rig>/refinery/rig/` layouts).
 */
export declare const getRemoteOriginUrl: (repoPath: string) => string | null;
/**
 * Best-effort detection of the repository's default branch (#243).
 *
 * Reads `git symbolic-ref --short refs/remotes/origin/HEAD`, which resolves to
 * the short ref `origin/<branch>` that the local `origin/HEAD` points at, and
 * strips the `origin/` prefix. This is a purely local lookup — it never makes a
 * network call. Returns `null` when there is no git repo, no `origin` remote, no
 * `origin/HEAD` (e.g. it was never set by clone, or the repo is detached), or
 * git is unavailable, so callers can fall back to a configured/default branch.
 */
export declare const getDefaultBranch: (repoPath: string) => string | null;
/**
 * Name of the currently checked-out branch, or `null` when HEAD is detached
 * (CI checkouts, `git checkout <sha>`), the directory is not a git worktree, or
 * git is unavailable.
 *
 * `git rev-parse --abbrev-ref HEAD` prints the literal `HEAD` for a detached
 * checkout. We map that (and empty output) to `null` so callers fall back to the
 * flat/default index rather than ever creating a branch literally named
 * "HEAD" (#2106).
 */
export declare const getCurrentBranch: (repoPath: string) => string | null;
/**
 * Sanitize a repository name to prevent argument injection and ensure
 * cross-platform filesystem compatibility.
 *
 * 1. Strips leading dashes to prevent git command-line argument injection
 *    (e.g., --upload-pack=evil).
 * 2. Replaces characters that are unsafe for directory names across
 *    platforms (Windows/macOS/Linux) with underscores.
 * 3. Blocks path traversal segments ("." and "..") and Windows reserved
 *    names (e.g., CON, NUL) to prevent directory escape.
 */
export declare const sanitizeRepoName: (name: string) => string;
/**
 * Parse a repository name out of a git remote URL. Handles common shapes
 * including SSH (git@host:owner/repo.git) and HTTPS (https://host/owner/repo.git).
 *
 * Returns a sanitized, filesystem-safe name or null if no name could be inferred.
 * Returning null (rather than 'unknown') allows callers to use ?? null-coalescing
 * for fallbacks without risk of registry collisions on 'unknown'.
 */
export declare const parseRepoNameFromUrl: (url: string | null | undefined) => string | null;
/**
 * Convenience wrapper: derive a registry-friendly name from the repo's
 * `origin` remote, or `null` when it cannot be inferred.
 */
export declare const getInferredRepoName: (repoPath: string) => string | null;
/**
 * An inclusive run of changed lines in the NEW file, 1-based like `@@` headers
 * and every other git line number. Graph rows are 0-based (#2377), so a consumer
 * comparing the two converts one side first — see `coalesceHunks` callers.
 */
export interface DiffHunk {
    startLine: number;
    endLine: number;
    /** Phantom brand, never set — see {@link GraphLineRange}. */
    readonly lineBase?: 'git1';
}
export interface FileDiff {
    filePath: string;
    hunks: DiffHunk[];
}
/**
 * Parse unified diff output (with -U0) into per-file hunk ranges.
 * Extracts the new-file line ranges from @@ hunk headers.
 *
 * A pure deletion adds no new lines, and unified diff spells that empty range
 * as the line BEFORE it: `@@ -4,2 +3,0 @@` removed old lines 4–5 from between
 * new lines 3 and 4 (git emits `+0,0` when the deletion is at the head of the
 * file). The hunk still says WHERE the change landed, so it becomes the
 * one-line range at that anchor rather than being dropped. Dropping it left the
 * file entry with no hunks at all, so `detect_changes` contributed no bound for
 * the path, issued no query, and reported "No changes detected." for a commit
 * that deleted a function (#2915 review).
 *
 * The anchor line only, not the pair straddling the gap: a symbol that
 * contained the deleted text still contains the anchor, whereas extending to
 * the following line would also claim a symbol that merely STARTS after the
 * gap — the widening {@link coalesceHunks} is careful never to do.
 */
export declare function parseDiffHunks(diffOutput: string): FileDiff[];
/**
 * Merge a file's hunks into sorted, non-touching ranges.
 *
 * `detect_changes` used to fold one `(n.startLine <= $hunkEndI AND n.endLine >=
 * $hunkStartI)` pair per hunk into a single Cypher `WHERE` clause. A
 * machine-generated file (a cache JSON, a lockfile, a golden fixture) diffs at
 * thousands of hunks with `-U0`, and the resulting expression tree is deep
 * enough that LadybugDB's recursive evaluator copy overflows its worker-thread
 * stack: a bare SIGBUS with no error output where secondary threads get 512 KB
 * (macOS), and a swallowed 30s query timeout where they get more (#2915).
 *
 * Only ranges that overlap or ABUT (`next.startLine <= current.endLine + 1`)
 * are merged, so the union covers exactly the lines the raw hunks covered —
 * coalescing can never widen a range into a symbol the hunks did not touch.
 */
export declare function coalesceHunks(hunks: readonly GraphLineRange[]): GraphLineRange[];
/**
 * An inclusive line range in the GRAPH's 0-based space, not git's 1-based one.
 *
 * A separate type from {@link DiffHunk} on purpose: the two carry the same two
 * fields in different bases, and mixing them is exactly the #2377 bug — every
 * symbol shifts one line and an edit to a symbol's last line reports nothing
 * changed. The phantom `lineBase` field is what makes that distinction real to
 * the compiler: two OPTIONAL properties with incompatible literal types are
 * mutually unassignable, so a value typed {@link DiffHunk} cannot reach
 * {@link hunksOverlapRange} without a conversion in between, while a bare
 * `{ startLine, endLine }` literal still satisfies both and no construction
 * site needs a cast. The brand catches plumbing that passes the wrong array,
 * not a range a caller built by hand out of 1-based numbers.
 */
export interface GraphLineRange {
    startLine: number;
    endLine: number;
    /** Phantom brand, never set — see above. */
    readonly lineBase?: 'graph0';
}
/**
 * Group a diff's hunks by file, converted into the graph's 0-based line space.
 *
 * The conversion lives here, at the parse boundary, rather than in each
 * consumer: `parseDiffHunks` stays faithful to git (1-based, like the `@@`
 * headers it reads) and everything downstream compares graph-native values.
 *
 * A path can appear twice in one diff (e.g. a rename reported alongside an
 * edit), so hunks accumulate per path instead of the later entry winning —
 * accumulated raw first, coalesced once, so a path repeated K times costs one
 * sort rather than K.
 */
export declare function coalesceHunksByPath(fileDiffs: FileDiff[]): Map<string, GraphLineRange[]>;
/**
 * Does any hunk overlap the inclusive line range [startLine, endLine]?
 *
 * `coalesced` must come from {@link coalesceHunks} — sorted and disjoint, which
 * is what makes the binary search valid — and both sides must use the same line
 * base.
 */
export declare function hunksOverlapRange(coalesced: GraphLineRange[], startLine: number, endLine: number): boolean;
