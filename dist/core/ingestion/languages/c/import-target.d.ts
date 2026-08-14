/**
 * Resolve a C #include path to a file in the workspace.
 *
 * Strategy:
 * 1. Check for a same-directory sibling relative to the including file
 *    (matches C compiler `#include "…"` relative-lookup semantics).
 * 2. Check for an exact match (path as-is in the workspace).
 * 3. Fall back to suffix matching against all workspace file paths.
 *    Tie-breaking: prefer the match with the fewest path components
 *    (closest to root). On equal depth, break ties lexicographically
 *    by normalized path to ensure deterministic resolution regardless
 *    of filesystem iteration order.
 */
export declare function resolveCImportTarget(targetRaw: string, fromFile: string, allFilePaths: ReadonlySet<string>): string | null;
