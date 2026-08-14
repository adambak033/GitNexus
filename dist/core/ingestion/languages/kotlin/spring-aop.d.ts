import { type SpringAopOwnerFact } from '../../frameworks/spring/aop.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import { type KotlinAnnotationSyntaxFact } from './spring-di.js';
export type KotlinSpringAopAnnotationFact = KotlinAnnotationSyntaxFact;
export type KotlinSpringAopFact = SpringAopOwnerFact<KotlinSpringAopAnnotationFact>;
/**
 * Capture Spring AOP syntax from the class node already surfaced by Kotlin's
 * scope query. The shared layer resolves annotations and rejects non-default
 * use-site targets after imports and package visibility have finalized.
 */
export declare function captureKotlinSpringAopFacts(classNode: SyntaxNode, filePath: string): KotlinSpringAopFact[];
export declare const attachKotlinSpringAopMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
