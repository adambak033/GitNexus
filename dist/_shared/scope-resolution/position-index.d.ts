/**
 * `PositionIndex` — O(log N_file) scope-at-position lookup
 * (RFC §3.1; Ring 2 SHARED #912).
 *
 * Per-file sorted array of `(range, scopeId)` entries, sorted by start
 * position ASC (`startLine`, then `startCol`). `atPosition(filePath, line,
 * col)` binary-searches for the last entry whose start ≤ (line, col), then
 * scans backward through the sorted prefix and returns the first entry
 * whose range contains the query position.
 *
 * **Why this works.** `ScopeTree`'s invariants (parent strictly contains
 * child; siblings don't overlap) guarantee that the scopes containing a
 * given point form an **ancestor chain**. When scanning backward through
 * entries sorted by start position ASC, the first scope we find that
 * contains the query is the innermost one — any deeper-starting scope
 * that also contained the query would appear *later* in the sorted array,
 * but we're only scanning entries with start ≤ query, so anything later
 * necessarily starts after the query and can't contain it.
 *
 * Expected complexity: `O(log N_file + D)` where `D` is the lexical depth
 * at the query position (typically ≤ 10). Worst-case degrades to `O(N_file)`
 * only under pathological inputs (many scopes starting at the same line).
 *
 * **Line/column conventions.** Matches `Range` in `types.ts`: lines are
 * 1-based, columns are 0-based. Ranges are **inclusive on both ends** —
 * a scope whose `endLine:endCol` equals the query position still contains
 * it. That matches how tree-sitter captures bodies (closing brace
 * included) and how closed PR #902's `enclosingFunctions` behaved.
 */
import type { Scope, ScopeId } from './types.js';
export interface PositionIndex {
    /** Total scope entries indexed across all files. */
    readonly size: number;
    /**
     * Innermost scope containing `(line, col)` in `filePath`, or `undefined`
     * when nothing contains it (position before file start, after file end,
     * or filePath not indexed).
     *
     * **Touching-boundary semantics.** Ranges are inclusive on both ends.
     * When two sibling scopes share a boundary point — e.g.
     * `[5:0, 10:0]` and `[10:0, 15:0]`, which is legal under `ScopeTree`'s
     * non-overlap invariant — a query at the shared point `(10, 0)` is
     * contained by **both**. The innermost-wins tie-break rule applies as
     * usual: since neither is nested inside the other, the one that
     * **starts latest** wins, i.e. the **right** sibling. The mechanism
     * is the backward scan through the start-position-sorted array (see
     * `findLastStartLteIndex` below) — both siblings land before the
     * upper-bound cursor, and the right sibling is scanned first. Queries at non-boundary positions between them naturally
     * fall to the unique containing scope.
     */
    atPosition(filePath: string, line: number, col: number): ScopeId | undefined;
}
/**
 * Build a `PositionIndex` from a flat list of `Scope` records.
 *
 * Duplicate `id`s are tolerated and deduplicated — the caller's
 * `ScopeTree.buildScopeTree` is the authoritative validator of scope
 * identity, and the position index does not need to re-check that
 * invariant.
 */
export declare function buildPositionIndex(scopes: readonly Scope[]): PositionIndex;
//# sourceMappingURL=position-index.d.ts.map