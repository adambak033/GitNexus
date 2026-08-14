import { type SpringConditionalOwnerFact } from '../../frameworks/spring/conditionals.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import { type JavaAnnotationSyntaxFact } from './spring-di.js';
export type JavaSpringConditionalAnnotationFact = JavaAnnotationSyntaxFact;
export type JavaSpringConditionalFact = SpringConditionalOwnerFact<JavaSpringConditionalAnnotationFact>;
/**
 * Capture Spring condition syntax while Java's existing class traversal already
 * has the AST node in hand. Framework/FQN semantics are resolved later.
 */
export declare function captureJavaSpringConditionalFacts(classNode: SyntaxNode, filePath: string): JavaSpringConditionalFact[];
export declare const attachJavaSpringConditionalMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
