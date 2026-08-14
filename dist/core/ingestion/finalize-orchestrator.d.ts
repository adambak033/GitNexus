/**
 * `finalizeScopeModel` — turn a workspace's `ParsedFile[]` into a
 * materialized `ScopeResolutionIndexes` (RFC §3.2 Phase 2; Ring 2 PKG #921).
 *
 * Thin integration glue, per issue #884's boundary: all algorithmic logic
 * lives in `gitnexus-shared` (finalize algorithm #915, the four per-file
 * indexes #913, the method-dispatch materialization #914, the scope tree
 * #912). This file does three things only:
 *
 *   1. Map `ParsedFile[]` → `FinalizeInput` and call shared `finalize()`.
 *   2. Build the four workspace-wide indexes from the union of per-file
 *      defs/scopes/modules/qualified-names.
 *   3. Bundle the results into `ScopeResolutionIndexes` for
 *      `MutableSemanticModel.attachScopeIndexes(...)`.
 *
 * ## What this module is NOT responsible for
 *
 *   - Invoking tree-sitter or running AST walks. That's the extractor (#919).
 *   - Per-language import-target resolution. Hooks are plumbed through
 *     but default to "unresolved" when no provider supplies them — the
 *     real adapters land with #922.
 *   - Populating `ReferenceIndex`. That's the resolution phase (#925).
 *   - Deciding which language uses registry-primary lookup. That's the
 *     flag reader (#924).
 *
 * ## Empty-input behavior
 *
 * When `parsedFiles` is empty (the common case today — no language has
 * migrated yet), the orchestrator produces a valid but empty bundle: all
 * indexes are zero-sized, the scope tree is empty, and
 * `finalize.stats.totalFiles === 0`. This lets downstream consumers
 * safely consult `model.scopes` without branching on presence.
 */
import type { FinalizeHooks, ParsedFile, WorkspaceIndex } from '../../_shared/index.js';
import type { ScopeResolutionIndexes } from './model/scope-resolution-indexes.js';
/**
 * Options forwarded to the orchestrator. All fields optional so callers
 * that don't yet have per-language hooks (today) get sensible defaults;
 * #922 will populate `hooks.resolveImportTarget` + friends per language.
 */
export interface FinalizeOrchestratorOptions {
    /**
     * Hooks forwarded to shared `finalize()`. Any omitted field gets a
     * no-op default: unresolved targets, empty wildcard expansion, append
     * merge for bindings.
     */
    readonly hooks?: Partial<FinalizeHooks>;
    /**
     * Opaque workspace context forwarded to hooks. `undefined` today; Ring
     * 2 PKG #922 populates this with a real cross-file index for the
     * per-language resolvers.
     */
    readonly workspaceIndex?: WorkspaceIndex;
}
/**
 * Produce a fully materialized `ScopeResolutionIndexes` from the
 * workspace's per-file artifacts.
 *
 * Pure function (given pure hooks). No I/O, no globals consulted. The
 * pipeline calls this once per ingestion run and hands the result to
 * `MutableSemanticModel.attachScopeIndexes`.
 */
export declare function finalizeScopeModel(parsedFiles: readonly ParsedFile[], options?: FinalizeOrchestratorOptions): ScopeResolutionIndexes;
