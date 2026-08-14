/**
 * PRECISE member resolution through a call result's RETURN SHAPE (R3-5).
 *
 * The last unanswered question from three rounds of blind-spot reports was
 * "who reads `wickRatio`?", where the field is produced by several functions
 * that each return an anonymous object containing it. Name inference must
 * refuse that — a read of `spike.wickRatio` could mean any producer, and a
 * wrong edge in the pre-edit safety gate is worse than a missing one — so no
 * amount of narrowing gets there. It needs EVIDENCE instead of inference.
 *
 * The evidence already exists in two halves that had never been joined:
 *
 *   1. The call-result type binding. `const alert = formatSpikeAlert(row)`
 *      binds `alert` to a `TypeRef` whose `rawName` is the callee. That
 *      machinery predates this work; it simply had nothing to resolve to when
 *      the callee returned an anonymous literal, because an anonymous literal
 *      named nothing.
 *   2. R3-4 gave it a name. A returned literal's keys are now owned by the
 *      producing function, so `formatSpikeAlert.wickRatio` is a real symbol.
 *
 * Joining them turns a refusal into a precise answer:
 *
 *     const alert = formatSpikeAlert(row);
 *     alert.wickRatio            →  Property:…:formatSpikeAlert.wickRatio
 *
 * and it works for exactly the case narrowing cannot: several producers sharing
 * a field name are no longer competitors, because the receiver says WHICH one.
 * That is why this runs before the unique-name fallback and registers its sites
 * as handled — a precise answer must never be second-guessed by a name match.
 *
 * BOUND, deliberately. This only fires where the value is BOUND to a name the
 * type binding could attach to. A field read off a bare parameter
 * (`function f(spike) { return spike.wickRatio }`) still has no receiver type
 * here, because typing it requires the CALLER's type to flow in — that is
 * inter-procedural and genuinely larger. Those reads keep falling through to
 * name inference, and keep being reported when it declines.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { PropertyNameIndex } from './unique-name-properties.js';
export interface ReturnShapeMemberStats {
    /** ACCESSES edges resolved through a call result's return shape. */
    readonly emitted: number;
    /**
     * Sites where the receiver WAS typed to a producer but that producer owns no
     * member of this name. Reported rather than dropped: it means the read and
     * the shape disagree, which is either a stale field name or a producer this
     * pass mis-attributed, and both are worth seeing.
     */
    readonly memberNotOnShape: number;
}
export declare function emitReturnShapeMemberAccesses(graph: KnowledgeGraph, indexes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, 
/** Sites a precise pass already owns — never re-resolved here. */
skipSites: ReadonlySet<string>, propertyNameIndex: PropertyNameIndex, 
/** Sites this pass resolves, so the name fallback leaves them alone. */
handledSink: Set<string>): ReturnShapeMemberStats;
