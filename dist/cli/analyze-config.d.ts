/**
 * Project-local `.gitnexusrc` support for `gitnexus analyze` (#243).
 *
 * Lets a repository commit recurring `analyze` defaults — default branch for the
 * generated regression example, AI-context / skills opt-outs, embedding knobs —
 * so contributors don't re-pass the same flags on every run. Design rules:
 *
 *   - Config is repo-local (`.gitnexusrc` at the resolved repo root). It is NOT
 *     read from `.gitnexus/` because that directory is index storage and is
 *     commonly gitignored.
 *   - JSON only. No YAML, no `package.json` field, no global `~/.gitnexus` file
 *     in this pass.
 *   - CLI flags always override config (see {@link mergeAnalyzeOptions}).
 *   - Fail closed: unknown keys, wrong value types, conflicting aliases, and
 *     invalid JSON all throw {@link GitNexusRcError} so a typo never silently
 *     no-ops. Errors are actionable and surface before any expensive analysis.
 *   - Config values never reach a shell. Strings are validated against control
 *     and hidden/bidirectional characters so they cannot inject markdown,
 *     JSON, or hidden controls into generated context files.
 *
 * Both a flat shape and a nested `analyze` block are accepted:
 *
 *     { "defaultBranch": "develop", "skipContextFiles": true }
 *     { "analyze": { "defaultBranch": "develop", "skipSkills": true } }
 *
 * When both set the same option, the nested `analyze` block wins (deterministic,
 * documented precedence). Conflicting *aliases at the same level* (e.g. both
 * `defaultBranch` and `branch`) are rejected.
 */
import type { AnalyzeOptions } from './analyze-options.js';
export declare const GITNEXUS_RC_FILENAME = ".gitnexusrc";
/** Final fallback when no branch is configured or detectable. */
export declare const DEFAULT_BRANCH_FALLBACK = "main";
/**
 * Thrown for any `.gitnexusrc` problem (missing-file is NOT an error — it
 * returns `undefined`). The message is user-facing and names the file so the
 * CLI can print it verbatim before starting the progress bar.
 */
export declare class GitNexusRcError extends Error {
    constructor(message: string);
}
/**
 * Validate a user-supplied branch name (from CLI or `.gitnexusrc`). Returns the
 * trimmed name or throws {@link GitNexusRcError}. Conservative but accepts the
 * shapes real branches use (`feature/foo-bar`, `release/1.2`, `develop`).
 */
export declare function validateBranchName(value: string, source: string): string;
/**
 * Best-effort validation for an auto-detected branch (from git). Never throws —
 * returns `undefined` for anything unusable so the resolver falls back to the
 * next precedence tier.
 */
export declare function sanitizeDetectedBranch(value: string | null | undefined): string | undefined;
/**
 * Locate, read, parse, validate, and normalize `.gitnexusrc` at `repoRoot`.
 *
 * @returns the normalized config defaults, or `undefined` when no file exists
 *          (the normal case). Throws {@link GitNexusRcError} on any problem.
 */
export declare function loadAnalyzeConfig(repoRoot: string): Partial<AnalyzeOptions> | undefined;
/**
 * Merge CLI options over `.gitnexusrc` defaults. CLI wins whenever it provides a
 * value — including an explicit `false` (so an explicit CLI off-switch beats a
 * config `true`). Config fills only the genuinely-unset (`undefined`) options.
 *
 * `stats` is special: Commander always materializes it (`true` by default,
 * `false` only when `--no-stats` is passed), so plain `??` can't tell "default
 * on" from "explicitly on". The rule is: a passed `--no-stats` (`stats: false`)
 * always wins; otherwise the config value applies. There is intentionally no
 * `--stats` counter-flag, so config can only turn stats off, not force it back
 * on against a `--no-stats`.
 *
 * `defaultBranch` is NOT resolved here — see {@link resolveDefaultBranch}, which
 * applies the CLI > config > auto-detect > "main" precedence chain.
 */
export declare function mergeAnalyzeOptions(cli: AnalyzeOptions, config: Partial<AnalyzeOptions> | undefined): AnalyzeOptions;
/**
 * Resolve the default branch threaded into generated context, applying the
 * precedence chain:
 *
 *   CLI `--default-branch` > `.gitnexusrc` `defaultBranch`/`branch`
 *     > auto-detected `origin/HEAD` > {@link DEFAULT_BRANCH_FALLBACK} ("main").
 *
 * User-supplied values (CLI, config) are validated strictly and throw on bad
 * input. The auto-detected value is best-effort and silently ignored if
 * unusable.
 */
export declare function resolveDefaultBranch(input: {
    cliBranch?: string;
    configBranch?: string;
    detectedBranch?: string | null;
}): string;
