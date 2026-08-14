/**
 * Setup Command
 *
 * One-time global MCP configuration writer.
 * Detects installed AI editors and writes the appropriate MCP config
 * so the GitNexus MCP server is available in all projects.
 */
/**
 * Build the `command` string written into an editor's hook settings, which the
 * editor shell-evaluates. `hookPath` is already forward-slash-normalized.
 *
 * On POSIX, single-quote the path: a single-quoted shell string expands nothing,
 * so spaces and metacharacters ($, backtick, ;, |, &, newline, parens) in the
 * install path cannot run as commands. The only character needing escaping
 * inside single quotes is the single quote, via the standard `'\''` idiom
 * (close, literal-quote, reopen). The previous double-quoted `node "..."` form
 * left $/backtick live — a code-execution risk for an adversarial $HOME.
 *
 * On Windows, filenames cannot contain these POSIX metacharacters and the path
 * is forward-slashed, so keep the double-quoted form with backslash-then-quote
 * escaping (CodeQL js/incomplete-sanitization safe ordering).
 */
export declare function formatHookCommand(hookPath: string, isWindows?: boolean): string;
interface SetupResult {
    configured: string[];
    skipped: string[];
    errors: string[];
}
/**
 * Copy the shared hook helpers from `srcDir` into `destDir`. The adapters
 * top-level `require()` the `.cjs` helpers, so a missing required helper makes
 * the installed hook crash with MODULE_NOT_FOUND. A failed copy is recorded as a
 * setup error, and the names of any failed REQUIRED helpers are returned so the
 * caller can fail closed (skip hook registration) instead of registering a hook
 * that crashes at runtime. `win-rm-list-json.ps1` is best-effort — its absence is
 * recorded but does not gate registration. Both the Claude and Antigravity
 * install paths copy this same list from hooks/claude/ (the canonical source).
 */
export declare function copyHookHelpers(srcDir: string, destDir: string, label: string, result: SetupResult): Promise<string[]>;
export declare const RENAMED_SKILL_DIRS: Readonly<Record<string, readonly string[]>>;
/**
 * Every legacy directory name superseded by a shipped rename. These no longer
 * exist in the bundled skills/ source, but a pre-rename install left them
 * behind in every editor target. Setup only warns about them (it cannot prove
 * it owns the contents); uninstall's ownership-by-name contract removes them.
 */
export declare const LEGACY_SKILL_DIR_NAMES: readonly string[];
export declare const setupCommand: (options?: {
    codingAgent?: string[] | string;
}) => Promise<void>;
export {};
