import { type SpringDiAnnotationFact, type SpringDiClassFact, type SpringDiDependencyFact, type SpringDiInjectionSiteFact } from '../../frameworks/spring/di-metadata.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export interface KotlinAnnotationSyntaxFact extends SpringDiAnnotationFact {
    readonly useSiteTarget?: string;
    readonly line: number;
}
export type KotlinSpringDependencyFact = SpringDiDependencyFact<KotlinAnnotationSyntaxFact>;
type KotlinSpringInjectionSiteKind = 'property' | 'constructor' | 'method';
export type KotlinSpringInjectionSiteFact = SpringDiInjectionSiteFact<KotlinAnnotationSyntaxFact, KotlinSpringInjectionSiteKind>;
export type KotlinSpringDiClassFact = SpringDiClassFact<KotlinAnnotationSyntaxFact, KotlinSpringInjectionSiteKind>;
export declare function kotlinSpringAnnotationFacts(node: SyntaxNode): KotlinAnnotationSyntaxFact[];
/**
 * Capture one class already surfaced by Kotlin's scope query. Kotlin-specific
 * syntax is normalized here while import/FQN semantics remain deferred until
 * post-resolution.
 */
export declare function captureKotlinSpringDiClassFact(classNode: SyntaxNode, filePath: string): KotlinSpringDiClassFact | null;
/** Attach resolved, framework-private DI metadata to Kotlin Class nodes. */
export declare const attachKotlinSpringDiMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
export {};
