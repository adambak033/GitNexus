import { type SpringAopOwnerFact } from '../../frameworks/spring/aop.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import { type JavaAnnotationSyntaxFact } from './spring-di.js';
export type JavaSpringAopAnnotationFact = JavaAnnotationSyntaxFact;
export type JavaSpringAopFact = SpringAopOwnerFact<JavaSpringAopAnnotationFact>;
/**
 * Capture Spring AOP syntax while Java's existing class traversal already has
 * the AST node in hand. Import/FQN resolution and pointcut matching remain in
 * the shared post-resolution layer.
 */
export declare function captureJavaSpringAopFacts(classNode: SyntaxNode, filePath: string): JavaSpringAopFact[];
export declare const attachJavaSpringAopMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
