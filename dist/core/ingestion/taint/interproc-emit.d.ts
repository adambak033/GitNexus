/**
 * Interprocedural taint emission (#2084 M4 U4) — materialise `TAINT_PATH`.
 *
 * Persists each cross-function {@link InterprocFinding} as ONE `TAINT_PATH`
 * edge from the source function node to the sink function node, with the
 * function-level hop chain + sink kind encoded in `reason` via the SHARED
 * `path-codec` (the same versioned wire format M3's intra-procedural `TAINTED`
 * edges use — never a second hand-rolled codec). The MCP `explain` tool decodes
 * it for cross-function path rendering (U7).
 *
 * `TAINT_PATH` was reserved at M0 (the RelationshipType + the `CodeRelation`
 * Function/Method node-pairs already exist), so materialisation needs zero
 * schema work. Like `TAINTED`, it stays out of `VALID_RELATION_TYPES` and the
 * web schema — `explain` is the discovery surface.
 *
 * Boundedness mirrors the M3 emit driver: dedup-before-cap (the solver already
 * deduped by `(source, sink, kind)`), a per-run findings cap, and unconditional
 * truncate-and-warn — never a silent drop.
 */
import type { KnowledgeGraph } from '../../graph/types.js';
import type { InterprocFinding } from './interproc-solver.js';
/** Confidence stamped on interprocedural `TAINT_PATH` edges. Lower than the
 *  intra-procedural `TAINTED` 1.0 — context-insensitive composition is a
 *  coarser signal (return/call-site merging). */
export declare const INTERPROC_TAINT_CONFIDENCE = 0.6;
/**
 * Default per-run cap on emitted `TAINT_PATH` edges (#2084 review P1-3).
 * Resolved into `RepoMeta.pdg` like the other pdg caps; `0` ⇒ unlimited.
 */
export declare const DEFAULT_PDG_MAX_INTERPROC_EDGES = 1000;
export interface InterprocEmitLimits {
    /** Max `TAINT_PATH` edges per run (post-dedup). `undefined`/0 ⇒ unlimited. */
    readonly maxEdges?: number;
}
export interface InterprocEmitResult {
    /** TAINT_PATH edges persisted. */
    edgesEmitted: number;
    /** Findings dropped by the per-run cap. */
    edgesDropped: number;
    /** Findings whose persisted hop path is a truncated prefix. */
    hopsTruncated: number;
    /** Findings skipped because an endpoint node was missing from the graph. */
    skippedMissingEndpoint: number;
}
/**
 * Persist cross-function findings as `TAINT_PATH` edges. `findings` is assumed
 * deduped + deterministically ordered (the solver's contract). Never throws on
 * valid input.
 */
export declare function emitInterprocTaint(graph: KnowledgeGraph, findings: readonly InterprocFinding[], limits?: InterprocEmitLimits, onWarn?: (message: string) => void): InterprocEmitResult;
