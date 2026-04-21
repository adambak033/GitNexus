/**
 * Emit CALLS edges for free-call reference sites whose target is
 * imported (or otherwise visible only via post-finalize scope.bindings).
 *
 * The shared `MethodRegistry.lookup` only consults `scope.bindings`
 * (pre-finalize / local-only) for free calls. Cross-file imports land
 * in `indexes.bindings` (post-finalize). Without this fallback, every
 * `from x import f; f()` resolves to "unresolved".
 *
 * **Free-call dedup contract (Contract Invariant I2):** free calls
 * collapse to one CALLS edge per (caller, target) pair regardless of
 * how many call sites the caller contains. Mirrors the legacy DAG's
 * dedup semantics (what the `default-params` / `variadic` / `overload`
 * fixtures expect). Member calls keep position-based dedup elsewhere.
 *
 * Generic; promoted from `languages/python/scope-resolver.ts` per the scope-resolution
 * generalization plan.
 */

import type { ParsedFile, Reference, ScopeId } from 'gitnexus-shared';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import { resolveCallerGraphId, resolveDefGraphId } from '../graph-bridge/ids.js';
import { findCallableBindingInScope } from '../scope/walkers.js';

export function emitFreeCallFallback(
  graph: KnowledgeGraph,
  scopes: ScopeResolutionIndexes,
  parsedFiles: readonly ParsedFile[],
  nodeLookup: GraphNodeLookup,
  _referenceIndex: { readonly bySourceScope: ReadonlyMap<ScopeId, readonly Reference[]> },
  handledSites: Set<string>,
): number {
  let emitted = 0;
  const seen = new Set<string>();

  for (const parsed of parsedFiles) {
    for (const site of parsed.referenceSites) {
      if (site.kind !== 'call') continue;
      if (site.explicitReceiver !== undefined) continue;

      const fnDef = findCallableBindingInScope(site.inScope, site.name, scopes);
      if (fnDef === undefined) continue;

      const callerGraphId = resolveCallerGraphId(site.inScope, scopes, nodeLookup);
      if (callerGraphId === undefined) continue;
      const tgtGraphId = resolveDefGraphId(fnDef.filePath, fnDef, nodeLookup);
      if (tgtGraphId === undefined) continue;
      // Always mark the site as handled — even when the dedup-collapse
      // means we don't add a new edge — so `emit-references` skips its
      // potentially-wrong fallback for the same site.
      handledSites.add(`${parsed.filePath}:${site.atRange.startLine}:${site.atRange.startCol}`);
      const relId = `rel:CALLS:${callerGraphId}->${tgtGraphId}`;
      if (seen.has(relId)) continue;
      seen.add(relId);
      graph.addRelationship({
        id: relId,
        sourceId: callerGraphId,
        targetId: tgtGraphId,
        type: 'CALLS',
        confidence: 0.85,
        // Match legacy DAG's reason convention so consumers that
        // assert `reason === 'import-resolved'` keep working.
        reason: fnDef.filePath !== parsed.filePath ? 'import-resolved' : 'local-call',
      });
      emitted++;
    }
  }
  return emitted;
}
