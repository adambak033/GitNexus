/**
 * Phase: springAop
 *
 * Materializes statically visible Spring proxy/advice behavior after every
 * language resolver has attached normalized metadata to the shared graph.
 * The post-MRO export in this file propagates declarative behavior through
 * METHOD_OVERRIDES/METHOD_IMPLEMENTS without changing @annotation semantics.
 *
 * @deps    scopeResolution
 * @reads   Class/Method nodes, HAS_METHOD edges, shared Spring AOP metadata
 * @writes  synthetic CodeElement nodes, DEFINES/DECLARES/ADVISED_BY edges
 */
import type { PipelinePhase } from './types.js';
export declare const DEFAULT_SPRING_AOP_MAX_CANDIDATE_INSPECTIONS_PER_ADVICE = 100000;
export declare const DEFAULT_SPRING_AOP_MAX_CANDIDATE_INSPECTIONS = 2000000;
export declare const DEFAULT_SPRING_AOP_MAX_ADVISED_EDGES_PER_ADVICE = 25000;
export declare const DEFAULT_SPRING_AOP_MAX_ADVISED_EDGES = 100000;
export interface SpringAopOutput {
    readonly advisedByEdges: number;
    readonly evidenceNodes: number;
    readonly unresolvedPointcuts: number;
    readonly candidateInspections: number;
    readonly truncatedAdvices: number;
}
export interface SpringAopInheritanceOutput {
    readonly inheritedBehaviorEdges: number;
}
export declare const springAopPhase: PipelinePhase<SpringAopOutput>;
/**
 * Propagate behavior evidence across the inheritance decisions materialized by
 * MRO. This is deliberately separate from pointcut matching: `@annotation`
 * continues to mean an annotation declared directly on the callable.
 */
export declare const springAopInheritancePhase: PipelinePhase<SpringAopInheritanceOutput>;
