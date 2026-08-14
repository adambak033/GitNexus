/**
 * Uninstall Command
 *
 * Reverses `gitnexus setup`: removes the GitNexus MCP server entries,
 * skills, and hooks that setup writes into each detected AI editor's
 * global configuration. The set of targets (paths, key paths, hook events,
 * needles, script dirs) is shared with setup.ts via editor-targets.ts, so the
 * two stay in lock-step.
 *
 * Surgical and idempotent: only gitnexus-owned keys/entries/dirs are
 * removed. Unrelated user config (other MCP servers, other hooks, JSONC
 * comments, indentation) is preserved. Files that are absent or that
 * never contained a gitnexus entry are left untouched.
 *
 * Ownership is by name: skill directories are matched by the bundled gitnexus
 * skill names, MCP entries by the `gitnexus` key, hooks by the gitnexus command
 * needle. There is no per-install provenance marker yet (a user dir that
 * happens to share a bundled skill name, or files a user added inside an
 * installed skill dir, are matched purely by name) — which is why uninstall is
 * a dry-run preview by default and prints the exact paths it will remove.
 * Richer provenance tracking is a tracked follow-up.
 *
 * Intentionally NOT done here (printed as hints instead, since both are
 * destructive in ways setup never caused):
 *   - per-repo indexes      → `gitnexus clean --all`
 *   - the global npm package → `npm uninstall -g gitnexus`
 *
 * Default is a dry-run preview; pass --force to apply.
 */
export declare const uninstallCommand: (options?: {
    force?: boolean;
}) => Promise<void>;
