/**
 * `ScopeTree` — the lexical-scope spine of the `SemanticModel`
 * (RFC §2.2 + §3.1; Ring 2 SHARED #912).
 *
 * Generalizes the `enclosingFunctions` pattern from closed PR #902 to
 * arbitrary `ScopeKind`s. Owns the (parent ↔ children) relationship
 * derived from each `Scope.parent` pointer, and validates the structural
 * invariants a well-formed scope tree must satisfy.
 *
 * Invariants enforced at build time (throw on violation):
 *
 *   - Every non-`Module` scope has a non-null parent.
 *   - Every parent pointer references a scope that was also supplied to
 *     `buildScopeTree`.
 *   - Parent range **strictly contains** child range.
 *   - Sibling ranges under the same parent do not overlap.
 *   - Parent and child live in the same `filePath`. (Cross-file parent
 *     pointers would be a category error — a `File` scope is not the
 *     parent of another file's scopes; imports do that job.)
 *
 * Satisfies the `ScopeLookup` contract (defined in `./types.js`), so
 * `resolveTypeRef` (#916) and the scope-aware registries (#917) can take a
 * `ScopeTree` directly without adapters.
 *
 * Immutable surface: `byId` is a `ReadonlyMap`; children arrays are
 * `Object.freeze`d; miss lookups return a shared frozen empty array.
 */
import type { Scope, ScopeId, ScopeLookup, Range } from './types.js';
export interface ScopeTree extends ScopeLookup {
    readonly size: number;
    readonly byId: ReadonlyMap<ScopeId, Scope>;
    getScope(id: ScopeId): Scope | undefined;
    getParent(id: ScopeId): Scope | undefined;
    /** Child `ScopeId`s of `id`, in input order. Frozen empty array on miss. */
    getChildren(id: ScopeId): readonly ScopeId[];
    /**
     * Ancestor chain from the immediate parent up to (and including) the
     * root module scope. Excludes the starting scope itself. Frozen empty
     * array on miss / for a root scope.
     */
    getAncestors(id: ScopeId): readonly ScopeId[];
    has(id: ScopeId): boolean;
}
/**
 * Thrown by `buildScopeTree` when the input violates a structural
 * invariant. Carries the offending ids + the invariant name so failed
 * extraction pipelines can report actionable diagnostics.
 */
export declare class ScopeTreeInvariantError extends Error {
    readonly invariant: 'non-module-requires-parent' | 'parent-not-found' | 'parent-must-contain-child' | 'sibling-ranges-overlap' | 'parent-must-share-filepath' | 'duplicate-scope-id';
    constructor(invariant: 'non-module-requires-parent' | 'parent-not-found' | 'parent-must-contain-child' | 'sibling-ranges-overlap' | 'parent-must-share-filepath' | 'duplicate-scope-id', message: string);
}
/**
 * Build an immutable `ScopeTree` from a flat list of `Scope` records.
 *
 * Throws `ScopeTreeInvariantError` on the first invariant violation; a
 * malformed tree is a bug in the extraction pipeline, not a data case for
 * consumers to handle, so fail-fast is the correct posture.
 */
export declare function buildScopeTree(scopes: readonly Scope[]): ScopeTree;
/**
 * Whether `outer` (kind `outerKind`) is a valid parent for `inner` (kind
 * `innerKind`).
 *
 * Strict containment is the general rule. The single carve-out is the
 * `Module`/non-`Module` pair whose ranges are exactly equal — this happens
 * naturally when tree-sitter reports identical byte spans for the
 * `compilation_unit` (or equivalent file-root construct) and the file's
 * single top-level scope. Common shape: a C# file consisting of nothing
 * but `namespace X { ... }` with no leading or trailing trivia outside the
 * namespace's `{}` body — `compilation_unit` and `namespace_declaration`
 * both span exactly the same byte range. The `Module` is the universal
 * outer of any file-level scope by language semantics, so coincident
 * ranges should not break the parent chain.
 *
 * The carve-out is direction-asymmetric: only `Module`-as-outer parents a
 * same-range non-`Module`, never the reverse. This preserves the
 * acyclicity buildScopeTree relies on, and matches the corresponding
 * helper in `scope-extractor.ts` so `pass1BuildScopes` and the validator
 * agree on what a well-formed parent edge looks like.
 */
export declare function canParentScope(outer: Range, inner: Range, outerKind: Scope['kind'], innerKind: Scope['kind']): boolean;
//# sourceMappingURL=scope-tree.d.ts.map