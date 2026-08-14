/**
 * Git Clone Utility
 *
 * Shallow-clones repositories into the clone root (getGlobalDir()/repos/{name}/).
 * If already cloned, does git pull instead.
 */
export declare const REPO_NAME_PATTERN: RegExp;
/**
 * Extract the repository name from a git URL (HTTPS or SSH).
 *
 * Throws if the URL does not yield a filesystem-safe last segment. A name
 * like `..` or `foo/bar` would otherwise let `getCloneDir(name)` escape the
 * clone root via path traversal.
 */
export declare function extractRepoName(url: string): string;
/** Get the clone target directory for a repo name. */
export declare function getCloneDir(repoName: string): string;
/**
 * Validate a git URL to prevent SSRF attacks.
 * Only allows https:// and http:// schemes. Blocks private/internal addresses,
 * IPv6 private ranges, cloud metadata hostnames, and numeric IP encodings.
 */
export declare function validateGitUrl(url: string): void;
export interface CloneProgress {
    phase: 'cloning' | 'pulling';
    message: string;
}
/**
 * Build the `git clone` argument list for a given URL and target directory.
 *
 * The `--` separator is non-negotiable: it stops git from parsing a URL that
 * starts with `--` (e.g. `--upload-pack=evil`) as an option flag, which would
 * otherwise execute an attacker-chosen subprocess (CodeQL
 * js/second-order-command-line-injection, alerts #166/#167).
 *
 * Exported so the separator placement is testable without mocking spawn.
 */
/**
 * Detect Azure DevOps URLs — both self-hosted (via AZURE_DEVOPS_URL env)
 * and cloud (dev.azure.com / *.visualstudio.com).
 *
 * Self-hosted Azure DevOps Server instances use arbitrary hostnames
 * (e.g. `http://tfs.corp.example/Collection/Project/_git/Repo`), so the
 * function checks `AZURE_DEVOPS_URL` first. Cloud addresses are a
 * hardcoded fallback so PAT injection works out-of-the-box for
 * dev.azure.com without extra configuration.
 */
export declare function isAzureDevOpsUrl(url: string): boolean;
/**
 * One-time startup warning when AZURE_DEVOPS_URL is configured over cleartext
 * http:// — the Azure DevOps PAT would then be sent unencrypted on every
 * clone. Self-hosted instances that only serve http are still supported (we
 * do not refuse), but operators rarely read request-time logs, so surface it
 * at boot too. Call once from server startup.
 */
export declare function warnIfInsecureAzureConfig(): void;
export declare function buildCloneArgs(url: string, targetDir: string): string[];
/**
 * Normalize a git URL into a comparable form.
 *
 * Two URLs are considered the same repository when their normalized forms
 * are identical: lowercased hostname, no trailing `.git`, no trailing
 * slashes on the path, default port stripped. Path comparison stays
 * case-sensitive because that's how Git hosts treat the path component on
 * the wire (case-folding GitHub's web UI is a separate convenience).
 *
 * Returns the original input if URL parsing fails — the caller can still
 * compare with the literal string for non-URL forms (e.g. SSH `git@host:`).
 */
export declare function normalizeGitUrlForCompare(url: string): string;
/**
 * Read `remote.origin.url` from an existing clone using `git config --get`.
 *
 * Returns `null` if the config key is absent, the spawn fails, or the
 * directory isn't a git repository. The caller decides what a missing
 * remote means for its threat model — for cloneOrPull, a missing remote
 * on an existing clone is treated as a refuse-to-pull condition.
 */
export declare function getRemoteOriginUrl(cwd: string): Promise<string | null>;
/**
 * Verify that an existing clone's `remote.origin.url` matches the requested
 * URL (after normalization). Throws on mismatch or missing remote.
 *
 * Closes the wrong-repo silent-analysis vector that Codex's adversarial
 * review on PR #1325 surfaced: clone dirs are keyed by URL basename, so a
 * request for `https://gitlab.example/attacker/repo.git` would otherwise
 * collide with an existing `~/.gitnexus/repos/repo` cloned from a different
 * origin and `git pull --ff-only` would silently succeed against the wrong
 * remote.
 *
 * Exported so the comparison logic is testable in isolation against any
 * tmpdir-based fixture, without needing to populate CLONE_ROOT.
 */
export declare function assertRemoteMatchesRequestedUrl(targetDir: string, requestedUrl: string): Promise<void>;
/**
 * Clone or pull a git repository.
 * If targetDir doesn't exist: git clone --depth 1
 * If targetDir exists with .git: git pull --ff-only (after verifying the
 * existing clone's remote.origin matches the requested URL).
 *
 * Security:
 *   - targetDir must resolve inside CLONE_ROOT (~/.gitnexus/repos/). The
 *     path.relative containment barrier below is the inline canonical idiom
 *     CodeQL's js/path-injection sanitizer recognizes.
 *   - validateGitUrl runs unconditionally on the requested URL — both the
 *     clone path and the pull path. An earlier shape only validated on the
 *     clone branch; an existing clone with the same basename let an
 *     attacker's URL skip the SSRF / scheme / private-IP checks (Codex
 *     adversarial review on PR #1325).
 *   - When the target already has `.git`, the existing clone's
 *     remote.origin.url is fetched and compared (normalized) to the
 *     requested URL. Refuses to pull if they differ — this closes the
 *     wrong-repo silent-analysis vector where two URLs sharing a basename
 *     would collide on the same on-disk clone dir.
 *   - The git URL is passed after a `--` separator so a value beginning with
 *     `--` (e.g. `--upload-pack=evil`) cannot be interpreted as a git option
 *     (CodeQL js/second-order-command-line-injection).
 */
export declare function cloneOrPull(url: string, targetDir: string, onProgress?: (progress: CloneProgress) => void, options?: {
    token?: string;
}): Promise<string>;
/**
 * Hosts the per-request GitHub PAT may be sent to. Exported so the
 * /api/analyze boundary check and this injection-site check share one
 * allowlist (they must agree, or a token accepted by the API could be
 * silently dropped — or worse — at injection).
 */
export declare const GITHUB_TOKEN_HOSTS: ReadonlySet<string>;
/**
 * Build the spawn env for `git`. Suppresses credential prompts and, when a
 * credential resolves (see resolveGitCredential), injects a single
 * host-scoped Authorization header via the `GIT_CONFIG_*` env protocol
 * (git ≥2.31) so credentials never appear in argv or the URL. Appends after
 * any existing `GIT_CONFIG_COUNT` rather than overwriting it. Exported for
 * unit tests.
 */
export declare function buildGitEnv(baseEnv: NodeJS.ProcessEnv, options?: {
    token?: string;
    url?: string;
}): NodeJS.ProcessEnv;
