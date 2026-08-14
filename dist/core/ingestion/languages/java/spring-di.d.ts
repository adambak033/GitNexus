import { type SpringDiAnnotationFact, type SpringDiClassFact, type SpringDiDependencyFact, type SpringDiInjectionSiteFact } from '../../frameworks/spring/di-metadata.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export interface JavaAnnotationSyntaxFact extends SpringDiAnnotationFact {
    readonly line: number;
}
export type JavaSpringDependencyFact = SpringDiDependencyFact<JavaAnnotationSyntaxFact>;
type JavaSpringInjectionSiteKind = 'field' | 'constructor' | 'method';
export type JavaSpringInjectionSiteFact = SpringDiInjectionSiteFact<JavaAnnotationSyntaxFact, JavaSpringInjectionSiteKind>;
export type JavaSpringDiClassFact = SpringDiClassFact<JavaAnnotationSyntaxFact, JavaSpringInjectionSiteKind>;
export declare function javaSpringAnnotationFacts(node: SyntaxNode): JavaAnnotationSyntaxFact[];
/**
 * Capture one class already surfaced by Java's scope query.
 *
 * `captures.ts` calls this from its existing query-match traversal, so Spring
 * DI does not perform a second recursive walk from the AST root.
 */
export declare function captureJavaSpringDiClassFact(classNode: SyntaxNode, filePath: string): JavaSpringDiClassFact | null;
/** Attach resolved, framework-private DI metadata to Class nodes. */
export declare const attachJavaSpringDiMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
export {};
