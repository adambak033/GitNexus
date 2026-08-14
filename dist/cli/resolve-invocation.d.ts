/**
 * npm 11.x npx-install-crash nudge for the `analyze` command (#1939).
 *
 * The gitnexus/pnpm/bun/npx selection itself lives in the canonical hook helper
 * (hooks/claude/resolve-analyze-cmd.cjs) — self-contained CJS because the copied
 * hook runtime cannot import from the package. We reuse it here via createRequire
 * instead of re-implementing it, so there is one source of truth for the
 * invocation decision. This module adds only the npm-version probe and the
 * warning, which are CLI-only. The relative path resolves identically from
 * src/cli/ (tsx, vitest) and dist/cli/ (shipped), since both sit one level under
 * the package root and `hooks/` is published.
 */
declare const NPX_REF: string;
export { NPX_REF };
export declare function getNpmMajorVersion(): number | null;
/**
 * One-line stderr nudge when an npm 11+ user is on the npx install path (#1939).
 * Skipped when a global `gitnexus`, `pnpm` or `bunx` is already preferred, so it
 * never nags users who are not exposed to the npx/arborist crash. "Preferred"
 * means usable, not merely on PATH: a `bunx` shim that no longer runs fails the
 * cjs liveness probe, resolves back to `npx`, and so still gets warned here —
 * without that, a broken bunx would suppress the warning AND emit a command that
 * cannot run.
 */
export declare function warnIfNpm11NpxRisk(): void;
