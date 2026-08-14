import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
export interface SpringConditionalAnnotationFact {
    readonly name: string;
    readonly text: string;
    readonly line: number;
}
export interface SpringConditionalOwnerFact<Annotation extends SpringConditionalAnnotationFact = SpringConditionalAnnotationFact> {
    readonly ownerScopeId: ScopeId;
    readonly ownerKind: 'class' | 'callable';
    readonly annotations: readonly Annotation[];
}
export interface SpringConditionalMetadataAdapter<Annotation extends SpringConditionalAnnotationFact> {
    getFacts(filePath: string): readonly SpringConditionalOwnerFact<Annotation>[];
    isPackageVisibilityIncomplete(filePath: string): boolean;
}
export declare function hasSpringConditionalRelevantAnnotation(annotations: readonly Pick<SpringConditionalAnnotationFact, 'name'>[]): boolean;
/**
 * Build a post-resolution Spring conditional attacher shared by language
 * adapters. Adapters capture syntax and package-visibility facts; this module
 * owns framework annotation semantics and graph representation.
 */
export declare function createSpringConditionalMetadataAttacher<Annotation extends SpringConditionalAnnotationFact>(adapter: SpringConditionalMetadataAdapter<Annotation>): (graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, indexes: ScopeResolutionIndexes) => void;
