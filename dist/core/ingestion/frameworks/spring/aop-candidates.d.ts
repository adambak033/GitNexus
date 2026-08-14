import type { GraphNode } from '../../../../_shared/index.js';
import type { SpringAopStaticPointcut } from './aop.js';
export interface SpringAopOwnedMethod {
    readonly method: GraphNode;
    readonly owner: GraphNode;
}
export interface SpringAopCandidateIndex {
    readonly totalCandidates: number;
    candidatesFor(pointcut: SpringAopStaticPointcut): readonly SpringAopOwnedMethod[];
}
/**
 * Build immutable candidate lists once per pipeline run. The pointcut matcher
 * remains the final authority; this index only returns safe supersets.
 */
export declare function createSpringAopCandidateIndex(candidates: readonly SpringAopOwnedMethod[], methodAnnotations: ReadonlyMap<string, ReadonlySet<string>>): SpringAopCandidateIndex;
