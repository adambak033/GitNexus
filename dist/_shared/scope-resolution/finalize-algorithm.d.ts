/**
 * `finalize` — cross-file finalize algorithm for the SemanticModel
 * (RFC §3.2 Phase 2; Ring 2 SHARED #915).
 *
 * Pure logic that takes per-file parse output (`ParsedImport[]` +
 * `SymbolDefinition[]`) and returns:
 *
 *   - Linked `ImportEdge[]` per module scope, with `targetModuleScope` and
 *     `targetDefId` filled where resolvable; edges that could not be
 *     resolved within the hard fixpoint cap are marked
 *     `linkStatus: 'unresolved'`.
 *   - Materialized `bindings` per module scope — local defs merged with
 *     imported / wildcard-expanded / re-exported names via the provider's
 *     `mergeBindings` precedence.
 *   - The SCC condensation of the import graph, exposed so disjoint SCCs
 *     can be processed in parallel by callers that want that.
 *
 * The algorithm is **SCC-aware**: it runs Tarjan SCC over the file-level
 * import graph, processes SCCs in reverse-topological order (leaves
 * first), and within each SCC runs a bounded fixpoint link pass capped at
 * `N = |edges in SCC|`. Cyclic imports finalize without hanging; malformed
 * inputs are bounded by the cap.
 *
 * **No language-specific logic.** Target resolution, wildcard expansion,
 * and binding precedence all go through caller-supplied hooks
 * (`resolveImportTarget`, `expandsWildcardTo`, `mergeBindings`) that
 * match the LanguageProvider surface from #911.
 *
 * **Non-binding imports rule.** `dynamic-unresolved` passes through with
 * `targetFile: null`; `dynamic-resolved` and `side-effect` resolve to
 * file-level `ImportEdge`s. None of these materialize `BindingRef`s.
 */
import type { SymbolDefinition } from './symbol-definition.js';
import type { BindingRef, ImportEdge, ParsedImport, ScopeId, WorkspaceIndex } from './types.js';
/** Per-file input for the finalize pass. */
export interface FinalizeFile {
    readonly filePath: string;
    /** The module scope id for this file; owns the finalized imports + bindings. */
    readonly moduleScope: ScopeId;
    readonly parsedImports: readonly ParsedImport[];
    /**
     * Defs exported from this file — the "what other files can import by name"
     * surface. Typically those with `isExported: true` (the module's own
     * declarations); parsers MAY also surface re-exported names here as a
     * shortcut, but it is no longer required for correctness.
     *
     * **Multi-hop re-export contract.** `finalize` resolves an edge
     * `A → B (importedName: 'X')` by first looking up `X` in `B.localDefs`.
     * If `B` only has `export { X } from './C'` and does NOT surface `X` in
     * its own `localDefs`, `finalize` falls back to the precomputed
     * per-file re-export closure (`buildReexportClosures`), which encodes
     * every name reachable through `B`'s named and wildcard re-exports —
     * including transitively through cyclic SCCs. The lookup is O(1) and
     * inherits the upstream `targetDefId`, populating `transitiveVia` with
     * the file paths traversed to reach the leaf def.
     *
     * Surfacing re-exported names in `localDefs` is still a valid (and
     * slightly cheaper) optimization: the direct lookup short-circuits the
     * closure consult. Parsers SHOULD prefer surfacing names they can resolve
     * statically (e.g., `export { X } from './c'` when `c.ts` is parsed in
     * the same workspace), and rely on the closure for the long tail of
     * barrel patterns.
     *
     * The fixpoint does NOT mutate `localDefs` across iterations — it is
     * static input.
     */
    readonly localDefs: readonly SymbolDefinition[];
}
/** Input to `finalize`. */
export interface FinalizeInput {
    readonly files: readonly FinalizeFile[];
    /** Opaque workspace context forwarded to provider hooks. */
    readonly workspaceIndex: WorkspaceIndex;
}
/**
 * Provider-supplied hooks. Mirror the optional LanguageProvider scope-
 * resolution hooks declared in #911; `finalize` calls them pure-ly and
 * expects pure answers.
 */
export interface FinalizeHooks {
    /**
     * Resolve a raw import target to the concrete file path that owns it.
     * Return `null` when no target file is resolvable (e.g., `np.foo` when
     * `numpy` is external to the workspace).
     */
    resolveImportTarget(targetRaw: string, fromFile: string, workspaceIndex: WorkspaceIndex, parsedImport?: ParsedImport): string | readonly string[] | null;
    /**
     * Reclassify syntax that names an imported symbol as a namespace import
     * after target resolution proves the symbol is itself a module.
     */
    readonly isNamespaceImport?: (parsedImport: ParsedImport, targetFile: string, fromFile: string) => boolean;
    /**
     * For a wildcard `import * from M`, return the names visible in the
     * exporting module scope `M`. The finalize pass looks each name up in
     * `M`'s local defs to produce a concrete `BindingRef`; names with no
     * matching export are dropped.
     */
    expandsWildcardTo(targetModuleScope: ScopeId, workspaceIndex: WorkspaceIndex): readonly string[];
    /**
     * Merge `incoming` bindings into `existing` for a given name. Called
     * once per name at each scope. Typical rules:
     *   - Python: local > imported > wildcard (last-write-wins within tier).
     *   - Rust: explicit `use` > glob; `pub use` overrides.
     * Return value replaces the bucket entirely — no implicit append.
     */
    mergeBindings(existing: readonly BindingRef[], incoming: readonly BindingRef[], scope: ScopeId): readonly BindingRef[];
}
/** One SCC in the file-level import graph. */
export interface FinalizedScc {
    readonly files: readonly string[];
    /** True iff this SCC has ≥ 2 files OR a single file that self-imports. */
    readonly isCycle: boolean;
}
/**
 * Counters reported by `finalize`.
 *
 * **Counting granularity** — `totalEdges` is **per-generated-`ImportEdgeDraft`**,
 * which may exceed the number of `ParsedImport` records when
 * `resolveImportTarget` returns a multi-file array (e.g. Go package-scoped
 * imports fan out to every `.go` file in the target directory). A single
 * `wildcard` ParsedImport that expands to N exports also counts as one
 * linked edge here; the materialized output (`FinalizeOutput.imports`) will
 * have N edges for that input. `dynamic-unresolved` ParsedImports count as
 * linked (they pass through with no `linkStatus`), so `linkedEdges` ≠ "has a
 * BindingRef" — use the `bindings` map for that.
 *
 * In other words: `totalEdges >= input.parsedImports.length` summed
 * across files, and `linkedEdges + unresolvedEdges === totalEdges`.
 */
export interface FinalizeStats {
    readonly totalFiles: number;
    /** Total `ImportEdgeDraft` records generated (≥ ParsedImport count). */
    readonly totalEdges: number;
    /**
     * `ParsedImport`s whose finalized edge does NOT carry
     * `linkStatus: 'unresolved'`. Includes `dynamic-unresolved` pass-throughs.
     */
    readonly linkedEdges: number;
    /** `ParsedImport`s whose finalized edge carries `linkStatus: 'unresolved'`. */
    readonly unresolvedEdges: number;
    readonly sccCount: number;
    readonly largestSccSize: number;
}
export interface FinalizeOutput {
    /** Linked `ImportEdge[]` per module scope, in original input order. */
    readonly imports: ReadonlyMap<ScopeId, readonly ImportEdge[]>;
    /** Materialized bindings per module scope. */
    readonly bindings: ReadonlyMap<ScopeId, ReadonlyMap<string, readonly BindingRef[]>>;
    /** SCCs in reverse-topological order (leaves first). */
    readonly sccs: readonly FinalizedScc[];
    readonly stats: FinalizeStats;
}
export declare function finalize(input: FinalizeInput, hooks: FinalizeHooks): FinalizeOutput;
//# sourceMappingURL=finalize-algorithm.d.ts.map