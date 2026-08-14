import type { GraphNode, ParsedFile, Range, ScopeId } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
export declare const SPRING_AOP_REASON_PREFIX = "spring-aop:v1:";
export declare const SPRING_AOP_EVIDENCE_DESCRIPTION_PREFIX = "Spring AOP: ";
export declare const SPRING_AOP_EVIDENCE_ID_PREFIX = "CodeElement:spring-aop:";
export type SpringAopBehavior = 'transactional' | 'caching' | 'cacheable' | 'cache-evict' | 'cache-put' | 'authorization';
export type SpringAopAdviceKind = 'around' | 'before' | 'after' | 'after-returning' | 'after-throwing' | 'pointcut';
export interface SpringAopAnnotationFact {
    readonly name: string;
    readonly text: string;
    readonly line: number;
    /** Kotlin use-site targets do not describe a callable annotation here. */
    readonly useSiteTarget?: string;
}
export interface SpringAopOwnerFact<Annotation extends SpringAopAnnotationFact = SpringAopAnnotationFact> {
    readonly ownerScopeId: ScopeId;
    readonly ownerKind: 'class' | 'callable';
    readonly ownerFilePath?: string;
    /** Exact syntax range used only as a fail-closed bridge for collapsed language scopes. */
    readonly ownerRange?: Range;
    /** The language models this owner/member as static, but it belongs to a singleton instance. */
    readonly singletonInstance?: true;
    readonly annotations: readonly Annotation[];
}
export interface SpringAopMetadataAdapter<Annotation extends SpringAopAnnotationFact> {
    getFacts(filePath: string): readonly SpringAopOwnerFact<Annotation>[];
    isPackageVisibilityIncomplete(filePath: string): boolean;
}
export interface SpringAopBehaviorReason {
    readonly kind: 'behavior';
    readonly annotation: string;
    readonly behavior: SpringAopBehavior;
    readonly declaredOn: 'class' | 'method';
    readonly activation: 'unknown';
    readonly proxy: 'possible';
}
export interface SpringAopAdviceReason {
    readonly kind: 'advice';
    readonly annotation: string;
    readonly advice: Exclude<SpringAopAdviceKind, 'pointcut'>;
    readonly pointcut: string;
    readonly match: 'static';
    readonly activation: 'unknown';
    readonly proxy: 'possible';
}
export interface SpringAopPointcutReason {
    readonly kind: 'pointcut';
    readonly annotation: string;
    readonly pointcut: string | null;
    readonly match: 'static' | 'unresolved';
    readonly resolution: 'resolved' | 'unknown';
}
export interface SpringAopAspectReason {
    readonly kind: 'aspect';
    readonly annotation: string;
    readonly activation: 'unknown';
    readonly registration: 'unknown';
}
export type SpringAopReason = SpringAopBehaviorReason | SpringAopAdviceReason | SpringAopPointcutReason | SpringAopAspectReason;
export interface SpringAopAspectRecord {
    readonly ownerId: string;
    readonly annotation: string;
    readonly line: number;
}
export interface SpringAopBehaviorRecord {
    readonly ownerId: string;
    readonly ownerKind: 'class' | 'callable';
    readonly annotation: string;
    readonly behavior: SpringAopBehavior;
    readonly line: number;
}
export interface SpringAopAdviceRecord {
    readonly ownerId: string;
    readonly annotation: string;
    readonly advice: SpringAopAdviceKind;
    readonly pointcut: string | null;
    readonly line: number;
}
export interface SpringAopGraphMetadata {
    readonly candidateFilePaths: ReadonlySet<string>;
    readonly aspectClassIds: ReadonlySet<string>;
    readonly singletonInstanceClassIds: ReadonlySet<string>;
    readonly aspects: readonly SpringAopAspectRecord[];
    readonly behaviors: readonly SpringAopBehaviorRecord[];
    readonly advices: readonly SpringAopAdviceRecord[];
}
export declare function getSpringAopGraphMetadata(graph: KnowledgeGraph): SpringAopGraphMetadata;
export declare function hasSpringAopRelevantAnnotation(annotations: readonly Pick<SpringAopAnnotationFact, 'name'>[]): boolean;
/**
 * Resolve syntax facts after imports and package visibility are complete.
 * Language adapters own AST shape only; this shared layer owns framework FQNs.
 */
export declare function createSpringAopMetadataAttacher<Annotation extends SpringAopAnnotationFact>(adapter: SpringAopMetadataAdapter<Annotation>): (graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, indexes: ScopeResolutionIndexes) => void;
export declare function encodeSpringAopReason(reason: SpringAopReason): string;
/** Decode only the current, validated reason contract; malformed/foreign rows fail closed. */
export declare function decodeSpringAopReason(value: unknown): SpringAopReason | undefined;
export declare function isSpringAopEvidenceNode(node: GraphNode): boolean;
export interface SpringAopExecutionPointcut {
    readonly kind: 'execution';
    readonly ownerPattern: string;
    readonly methodPattern: string;
    readonly visibility?: 'public';
    readonly parameterCount?: number;
}
export interface SpringAopWithinPointcut {
    readonly kind: 'within';
    readonly ownerPattern: string;
}
export interface SpringAopAnnotationPointcut {
    readonly kind: 'annotation';
    readonly annotation: string;
}
export type SpringAopStaticPointcut = SpringAopExecutionPointcut | SpringAopWithinPointcut | SpringAopAnnotationPointcut;
/** Parse the deliberately narrow, fully static pointcut subset supported in v1. */
export declare function parseSpringAopPointcut(expression: string): SpringAopStaticPointcut | null;
export declare function springAopPointcutMatches(pointcut: SpringAopStaticPointcut, owner: GraphNode, method: GraphNode, methodAnnotations?: ReadonlySet<string>): boolean;
