/**
 * Cross-file value references, resolved post-finalize (A2).
 *
 * `resolveReferenceSites` runs against the registries, and — as its own
 * comment says — "imports live in finalized bindings the registries can't
 * see". That is why free CALLS need `emitFreeCallFallback`. Reads had no
 * equivalent, so a module-scope `const` read from another file resolved to
 * nothing: `import { DEFAULT_FETCH_LIMIT } from './config.js'` followed by a
 * bare use produced no edge, while a CALL through the very same import
 * statement resolved fine. "Who imports this constant?" — the question behind
 * every constants refactor and dead-code trim — was unanswerable across files.
 *
 * This is the read/write counterpart to that call fallback, and it reuses the
 * walker built for finalized bindings rather than inventing a lookup.
 *
 * DELIBERATELY CROSS-FILE ONLY. Same-file reads already resolve through the
 * registries, so re-resolving them here would add nothing — and would add
 * something unwanted: `findValueBindingInScope` accepts `Const`/`Variable`,
 * which includes BLOCK-LOCAL values. Emitting an edge to one of those keeps
 * alive exactly the inert local symbols `pruneLocalSymbols` exists to drop,
 * inflating every indexed repo. A def in another file cannot be a block-local
 * of this one, so the file guard is what keeps this pass proportional.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
export interface ImportedValueRefStats {
    /** Cross-file value references resolved through finalized bindings. */
    readonly emitted: number;
}
export declare function emitImportedValueReferences(graph: KnowledgeGraph, indexes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, 
/** Sites an earlier pass already owns — never re-resolved here. */
skipSites: ReadonlySet<string>): ImportedValueRefStats;
