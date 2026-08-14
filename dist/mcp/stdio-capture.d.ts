/**
 * Stdio capture — leaf module with zero non-`node:` imports.
 *
 * Owns the singleton state that the MCP stdout sentinel needs:
 *   - `realStdoutWrite` / `realStderrWrite`: process.stdout.write /
 *     process.stderr.write captured at module load, BEFORE anything else
 *     can rebind them.
 *   - `activeStdoutWrite`: the write handler that silenceStdout/restoreStdout
 *     cycles in pool-adapter restore to. Defaults to `realStdoutWrite`;
 *     `installGlobalStdoutSentinel` (in stdio-context.ts) registers the
 *     sentinel here at MCP startup so silence/restore preserves the sentinel.
 *
 * This module exists separately from `pool-adapter.ts` (which previously
 * owned the same state) so that `cli/mcp.ts`'s static-import closure does
 * NOT transitively pull in `@ladybugdb/core`. Codex's adversarial review on
 * PR #1383 found that the prior structure left a pre-sentinel window where
 * native-module init banners could reach raw stdout: `cli/mcp.ts` →
 * `mcp/stdio-context.ts` → `core/lbug/pool-adapter.ts` → `@ladybugdb/core`.
 * Routing the sentinel state through this leaf module breaks that chain.
 *
 * **Constraint:** keep this module a leaf. No non-`node:` imports — adding
 * any would re-introduce the import-time stdout-corruption hazard.
 */
type StdoutWrite = typeof process.stdout.write;
/** Captured at module load, before any rebinding. */
export declare const realStdoutWrite: StdoutWrite;
export declare const realStderrWrite: typeof process.stderr.write;
/**
 * Register a wrapper (e.g., the MCP sentinel) as the active stdout write.
 * silenceStdout/restoreStdout cycles in pool-adapter will preserve the
 * wrapper instead of unwinding to the raw realStdoutWrite. Returns the
 * previous value so callers can chain or restore.
 */
export declare function setActiveStdoutWrite(fn: StdoutWrite): StdoutWrite;
/**
 * Read the currently-active stdout write handler. Used by pool-adapter's
 * restoreStdout and watchdog so silence/restore preserves the sentinel.
 */
export declare function getActiveStdoutWrite(): StdoutWrite;
export {};
