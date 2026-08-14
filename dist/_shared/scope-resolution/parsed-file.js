/**
 * `ParsedFile` — the per-file artifact produced by `ScopeExtractor`
 * (RFC §3.2 Phase 1; Ring 2 PKG #919).
 *
 * The boundary between Phase 1 (extraction, per-file, parallelizable) and
 * Phase 2 (finalize, cross-file). One `ParsedFile` is emitted per source
 * file; the finalize orchestrator (#921) collects them into a workspace-
 * wide set and feeds them to the shared `finalize` algorithm (#915).
 *
 * ## Shape
 *
 *   - `scopes`           — every `Scope` created for this file, in tree-
 *                          topological order (module first, then children).
 *                          `Scope.bindings` carry **local-only** bindings at
 *                          this stage; finalize merges imports/wildcards on top.
 *   - `parsedImports`    — raw `ParsedImport[]` for this file; finalize
 *                          resolves each to a concrete `ImportEdge`.
 *   - `localDefs`        — defs structurally declared in this file. A
 *                          superset of every `Scope.ownedDefs` union.
 *                          Listed separately so `finalize` can dedup-index
 *                          without re-walking scopes.
 *   - `referenceSites`   — pre-resolution usage facts; populated by the
 *                          resolution phase into `ReferenceIndex`.
 *
 * ## What `ParsedFile` deliberately does NOT carry
 *
 *   - Linked `ImportEdge`s. Those are finalize output.
 *   - A `ScopeTree` instance. Callers build one from `scopes` (cheap —
 *     `buildScopeTree(parsedFile.scopes)`). Keeping the ParsedFile flat
 *     makes IPC serialization from worker threads straightforward.
 *   - Merged module-scope bindings. Finalize owns that materialization.
 *
 * ## Compatibility with `FinalizeFile`
 *
 * `FinalizeFile` (defined in `./finalize-algorithm.ts`) is a structural
 * subset of `ParsedFile` — `filePath`, `moduleScope`, `parsedImports`,
 * `localDefs`. A `ParsedFile` is trivially convertible to a `FinalizeFile`
 * by picking those four fields, so the finalize orchestrator threads
 * ParsedFile through to the shared algorithm without shape-shifting.
 *
 * ## Source-of-truth invariant
 *
 * `ParsedFile` is the single semantic model consumed by both the legacy
 * DAG (`gitnexus/src/core/ingestion/` outside `scope-resolution/`) and
 * the scope-resolution pipeline (`gitnexus/src/core/ingestion/scope-resolution/`).
 * Downstream passes MUST NOT build a parallel parse representation; if
 * a pass needs AST-level facts that `ParsedFile` doesn't expose, it
 * should reuse the orchestrator's `treeCache` rather than re-invoke
 * `parser.parse(...)` on its own. See the
 * `ScopeResolver` contract (`gitnexus/src/core/ingestion/scope-resolution/contract/scope-resolver.ts`)
 * for the full list of invariants downstream consumers rely on.
 */
export {};
//# sourceMappingURL=parsed-file.js.map