/**
 * BindingAccumulator — read-append-only accumulator that collects TypeEnv
 * bindings across files in the GitNexus analyzer pipeline.
 *
 * **Current behavior (both execution paths):** The accumulator carries only
 * file-scope (`scope = ''`) entries. Function-scope bindings are stripped
 * at both write sites:
 *
 * - **Worker path**: `parse-worker.ts` serializes only
 *   `typeEnv.fileScope()` entries across the IPC boundary.
 * - **Sequential path**: `type-env.ts::flush()` iterates only the FILE_SCOPE
 *   entry of the env map and writes `BindingEntry` records with
 *   `scope: ''` hardcoded.
 *
 * The narrowing exists because function-scope bindings have zero downstream
 * consumers today and were previously costing ~4.9 MB of heap + IPC on
 * every pipeline run. See `type-env.ts::flush()` and the `FileScopeBindings`
 * JSDoc in `parse-worker.ts` for the paired Phase 9 reversion checklist.
 *
 * **Historical quality asymmetry (Phase 9 consideration):** Even though
 * both paths now carry only file-scope data, the two paths were built
 * under different resolution capabilities, and a future Phase 9 reverter
 * that widens them back to all scopes will inherit that asymmetry:
 *
 * - **Sequential path** had (and would regain) access to the full
 *   `SymbolTable` and `importedBindings`, so its bindings benefit from
 *   Tier 2 cross-file propagation.
 * - **Worker path** runs without `SymbolTable` / `importedBindings` and
 *   can only produce Tier 0 (annotation-declared) and local Tier 1
 *   (same-file constructor inference) bindings.
 *
 * Phase 9 consumers that trust every entry equally will silently produce
 * worse results for large repos (worker-dominant) than small ones
 * (sequential-dominant). If Phase 9 needs homogeneous quality, either
 * (a) tag entries with their tier at insert time so consumers can filter,
 * or (b) post-process worker-path entries through a follow-up resolution
 * pass after the main-thread `SymbolTable` is complete.
 *
 * **Lifecycle contract**: single-use — `append* → finalize → consume → dispose`.
 * After `dispose()` the accumulator is permanently dead: any mutating call
 * (`appendFile`) throws, and read methods return empty/undefined as if the
 * accumulator had never been appended to. The instance is not recyclable;
 * construct a new one for a new pipeline run. Finalization and disposal are
 * orthogonal state dimensions and may be invoked in either order.
 */
export interface BindingEntry {
    readonly scope: string;
    readonly varName: string;
    readonly typeName: string;
}
/**
 * Minimal graph-node shape required by `enrichExportedTypeMap()`. Intentionally
 * narrower than the full `GraphNode` type in `graph/types.ts` so tests can
 * construct a minimal mock without depending on the full graph module, and
 * so the enrichment logic is a pure function over this contract.
 *
 * Matches the shape of the real `KnowledgeGraph` node's `properties.isExported`
 * access path — tests that use a different shape silently pass while
 * production fails.
 */
export interface EnrichmentGraphNode {
    readonly id: string;
    readonly properties?: {
        readonly isExported?: boolean;
    } | undefined;
}
/**
 * Minimal graph lookup interface used by `enrichExportedTypeMap()`.
 * Consumes only the method the enrichment loop actually calls.
 */
export interface EnrichmentGraphLookup {
    getNode(id: string): EnrichmentGraphNode | undefined;
}
/**
 * Merge file-scope bindings from a (finalized) `BindingAccumulator` into an
 * `exportedTypeMap` for symbols whose graph nodes are marked as exported.
 *
 * This is the single source of truth for the worker-path ExportedTypeMap
 * enrichment loop. Previously the logic lived inline in `pipeline.ts` and
 * the test suite reimplemented it as a `runEnrichmentLoop` helper — a
 * drift-prone pattern that meant tests could pass while production regressed.
 * Extracting it here makes the production code call the same function the
 * tests call.
 *
 * **Node ID candidate order**: `Function:{filePath}:{name}` →
 * `Variable:{filePath}:{name}` → `Const:{filePath}:{name}`. First match wins.
 *
 * **Tier 0 priority**: if `exportedTypeMap` already has an entry for a
 * `(filePath, name)` pair, the accumulator entry does NOT overwrite it —
 * the SymbolTable tier-0 pass is authoritative. Without this guard, a
 * worker-path binding could clobber a higher-quality type from SymbolTable.
 *
 * **Finalize precondition**: the accumulator should be finalized before
 * calling this function. The lifecycle contract is
 * `append → finalize → enrich → dispose`. Finalization is not asserted
 * here (the test suite and pipeline both honor it separately), but any
 * append happening concurrently with this enrichment would be a lifecycle
 * bug at the caller level.
 *
 * @returns The number of new entries written into `exportedTypeMap`
 *          (0 on empty accumulator or when every candidate was filtered
 *          out by the export check or the Tier 0 guard).
 */
export declare function enrichExportedTypeMap(bindingAccumulator: BindingAccumulator, graph: EnrichmentGraphLookup, exportedTypeMap: Map<string, Map<string, string>>): number;
export declare class BindingAccumulator {
    private readonly _allByFile;
    private readonly _fileScopeByFile;
    private _totalBindings;
    private _finalized;
    private _disposed;
    /**
     * Append bindings for a file. Safe to call multiple times for the same file.
     * Throws if the accumulator has been finalized. Skips if entries is empty.
     *
     * The `entries` parameter is `readonly` — this method never mutates the
     * caller's array. Internally, the first `appendFile` call per filePath
     * makes a defensive copy (`slice()`), and subsequent calls push into the
     * accumulator's own storage.
     */
    appendFile(filePath: string, entries: readonly BindingEntry[]): void;
    /** Lock the accumulator — no further appends. Idempotent. */
    finalize(): void;
    /**
     * Release the accumulator's heap footprint. Clears both internal storage
     * maps and resets `_totalBindings` to zero. Idempotent — calling twice
     * is a no-op. Orthogonal to `finalize()` — calling `dispose()` does not
     * change the finalized state.
     *
     * **Single-use lifecycle.** This is a one-way terminal transition: the
     * accumulator is not recyclable. Any subsequent `appendFile` call throws
     * (`'BindingAccumulator: use after dispose'`), regardless of whether
     * `finalize()` was called first. Post-dispose reads do not throw —
     * they return empty/undefined state matching a never-appended-to
     * accumulator:
     *   - `fileCount === 0`
     *   - `totalBindings === 0`
     *   - `files()` yields an empty iterator
     *   - `getFile(x)` returns `undefined` for all `x`
     *   - `fileScopeEntries(x)` returns `[]` for all `x`
     *   - `fileScopeGet(x, y)` returns `undefined` for all `x, y`
     *   - `estimateMemoryBytes()` returns `0`
     *
     * Lifecycle note: the pipeline disposes the accumulator inside the
     * `finally` of the `crossFile` phase, which is scheduled after every
     * other accumulator consumer (Phase 9 call/assignment processing and
     * the ExportedTypeMap enrichment loop). The dispose call therefore
     * runs once, on both the happy path and the throw path of the
     * crossFile phase.
     */
    dispose(): void;
    /** Get all bindings for a file, or undefined if the file is unknown. */
    getFile(filePath: string): readonly BindingEntry[] | undefined;
    /**
     * Get only scope='' (file-level) entries as [varName, typeName] tuples.
     * For iteration-based consumers (e.g., `enrichExportedTypeMap`).
     * Returns an empty array for an unknown file.
     *
     * O(1) map lookup + O(n_file_scope) tuple reconstruction from the inner
     * Map. Does NOT walk function-scope entries.
     *
     * For point-lookup consumers (e.g., Phase 9 fallback), prefer
     * `fileScopeGet(filePath, name)` — O(1) with no allocation.
     */
    fileScopeEntries(filePath: string): readonly (readonly [string, string])[];
    /**
     * O(1) point-lookup for a single file-scope binding by (filePath, name).
     * Returns the typeName if found, `undefined` otherwise.
     *
     * This is the preferred lookup path for Phase 9 consumers that resolve
     * a single callee's return type — avoids the O(n_file_scope) iteration
     * and defensive-copy allocation of `fileScopeEntries()`.
     */
    fileScopeGet(filePath: string, name: string): string | undefined;
    /** Iterate over all file paths in insertion order. */
    files(): IterableIterator<string>;
    /** Number of distinct files with at least one binding. */
    get fileCount(): number;
    /** Total number of binding entries across all files. */
    get totalBindings(): number;
    /** Whether the accumulator has been finalized. */
    get finalized(): boolean;
    /**
     * Whether the accumulator has been disposed. Exposed for symmetry with
     * `finalized` so debug tooling and future Phase 9 consumers can detect a
     * disposed accumulator without inspecting empty state heuristically.
     *
     * Disposal and finalization are orthogonal: a disposed accumulator may or
     * may not be finalized, and vice versa. See `dispose()` for the full
     * lifecycle contract.
     */
    get disposed(): boolean;
    /**
     * Rough memory estimate in bytes (intentionally pessimistic).
     * Formula: sum of (ENTRY_OVERHEAD + char bytes of scope+varName+typeName) per entry
     *          + MAP_ENTRY_OVERHEAD + char bytes of filePath per file.
     *
     * Note: V8 stores all-ASCII strings as Latin-1 (1 byte/char) and only upgrades
     * to UCS-2 (2 bytes/char) for non-Latin-1 code points. Source paths and type names
     * are typically all-ASCII, so actual heap cost is roughly half what this returns.
     * The pessimistic factor is intentional — better to over-budget than under-budget.
     *
     * **⚠ Cost profile**: O(totalBindings) — iterates every entry in
     * `_allByFile` and reads three string `.length` properties per entry.
     * At a typical repo scale (10k files × ~20 file-scope bindings) this is
     * ~200k property reads per call. Call at most once per pipeline run,
     * NOT per file, per chunk, or per progress tick. The current single
     * call site is the dev-mode telemetry log at the pipeline finalize
     * seam. Adding a per-file-progress caller would silently make it
     * quadratic in repo size.
     */
    estimateMemoryBytes(): number;
}
