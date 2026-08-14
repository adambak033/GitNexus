/**
 * Phase: di
 *
 * Framework-neutral dependency-injection resolution. Per-language resolvers
 * identify injection sites and provider metadata; this phase performs only
 * graph-level type/heritage resolution and emits owner/site -> provider INJECTS edges.
 *
 * @deps    mro
 * @reads   graph (Class/Interface/member nodes and heritage/ownership edges)
 * @writes  graph (INJECTS edges)
 */
import type { PipelinePhase } from './types.js';
export interface DIOutput {
    injectsEdges: number;
    /** Kept for output compatibility; now counts every matched injection site. */
    fieldsScanned: number;
    /** Sites skipped because the requested type name itself was ambiguous. */
    ambiguousSkipped: number;
    /** Single-valued sites represented by multiple low-confidence candidates. */
    ambiguousInjections: number;
}
export declare const diPhase: PipelinePhase<DIOutput>;
