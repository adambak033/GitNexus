import { type SpringConditionalOwnerFact } from '../../frameworks/spring/conditionals.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
import { type KotlinAnnotationSyntaxFact } from './spring-di.js';
export type KotlinSpringConditionalAnnotationFact = KotlinAnnotationSyntaxFact;
export type KotlinSpringConditionalFact = SpringConditionalOwnerFact<KotlinSpringConditionalAnnotationFact>;
/**
 * Capture Kotlin condition syntax from the class node already surfaced by the
 * scope query. Kotlin syntax stays local; shared Spring semantics are attached
 * after resolution.
 */
export declare function captureKotlinSpringConditionalFacts(classNode: SyntaxNode, filePath: string): KotlinSpringConditionalFact[];
export declare const attachKotlinSpringConditionalMetadata: (graph: import("../../../graph/types.js").KnowledgeGraph, parsedFiles: readonly import('../../../../_shared/index.js').ParsedFile[], nodeLookup: import("../../scope-resolution/graph-bridge/node-lookup.js").GraphNodeLookup, indexes: import("../../model/scope-resolution-indexes.js").ScopeResolutionIndexes) => void;
