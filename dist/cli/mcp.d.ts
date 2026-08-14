/**
 * MCP Command
 *
 * Starts the MCP server in standalone mode.
 * Loads all indexed repos from the global registry.
 * No longer depends on cwd — works from any directory.
 *
 * IMPORTANT: this module's static-import closure is intentionally tiny
 * (one chain: `mcp/stdio-context.js` → `mcp/stdio-capture.js`, which is a
 * leaf with zero non-`node:` imports). All heavy backend modules
 * (`startMCPServer`, `LocalBackend`, `warnMissingOptionalGrammars`) load
 * via `await import(...)` AFTER `installGlobalStdoutSentinel()` runs.
 *
 * This closes the ESM-evaluation-order window where native init banners
 * from `@ladybugdb/core` (or any future heavy import) could reach raw
 * stdout before the sentinel exists. Codex's adversarial review on
 * PR #1383 found that even with the sentinel-install call as the first
 * statement of `mcpCommand`, ESM evaluates static imports of THIS module
 * before the function body runs — so any native side effects during
 * those imports happen before the sentinel can intercept them.
 *
 * If you find yourself adding a static `import` to this file, ask
 * whether the imported module (or anything it transitively imports)
 * touches `process.stdout` or loads a native binding at module init. If
 * either is true, switch it to a dynamic `await import(...)` inside
 * `mcpCommand` after the sentinel install. The regression test at
 * `gitnexus/test/integration/mcp/import-closure.test.ts` enforces this.
 */
export declare const mcpCommand: (options?: {
    http?: boolean;
    port?: string;
    host?: string;
    authToken?: string;
}) => Promise<void>;
