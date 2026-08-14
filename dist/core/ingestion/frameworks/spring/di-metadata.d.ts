import type { ParsedFile, ScopeId } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import { parseSpringInjectionType } from '../../di-extractors/spring.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
import { type SpringBeanFactoryMethodFact } from './bean-factories.js';
export interface SpringDiAnnotationFact {
    readonly name: string;
    readonly text: string;
}
export interface SpringDiDependencyFact<Annotation extends SpringDiAnnotationFact> {
    readonly name: string;
    readonly rawType: string;
    readonly annotations: readonly Annotation[];
}
export interface SpringDiInjectionSiteFact<Annotation extends SpringDiAnnotationFact, SiteKind extends string> {
    readonly kind: SiteKind;
    readonly memberName: string;
    readonly implicitConstructor: boolean;
    readonly annotations: readonly Annotation[];
    readonly dependencies: readonly SpringDiDependencyFact<Annotation>[];
}
export interface SpringDiClassFact<Annotation extends SpringDiAnnotationFact, SiteKind extends string> {
    readonly classScopeId: ScopeId;
    readonly classAnnotations: readonly Annotation[];
    readonly injectionSites: readonly SpringDiInjectionSiteFact<Annotation, SiteKind>[];
    readonly beanFactoryMethods?: readonly SpringBeanFactoryMethodFact<Annotation>[];
}
export declare function springAnnotationSimpleName(name: string): string;
export declare function hasSpringDiRelevantAnnotation(annotations: readonly SpringDiAnnotationFact[]): boolean;
export declare function hasSpringStereotypeSyntax(annotations: readonly SpringDiAnnotationFact[]): boolean;
type ParsedSpringInjectionType = NonNullable<ReturnType<typeof parseSpringInjectionType>>;
export interface SpringDiMetadataAdapter<Annotation extends SpringDiAnnotationFact, SiteKind extends string> {
    getFacts(filePath: string): readonly SpringDiClassFact<Annotation, SiteKind>[];
    isPackageVisibilityIncomplete(filePath: string): boolean;
    parseInjectionType(rawType: string): ParsedSpringInjectionType | null;
    capturedMemberKind: SiteKind;
    isInjectionAnnotationApplicable?(annotation: Annotation, site: SpringDiInjectionSiteFact<Annotation, SiteKind>): boolean;
    isQualifierAnnotationApplicable?(annotation: Annotation, site: SpringDiInjectionSiteFact<Annotation, SiteKind>): boolean;
    isFactoryQualifierAnnotationApplicable?(annotation: Annotation): boolean;
}
/**
 * Build the post-resolution Spring DI metadata hook shared by language adapters.
 * Language adapters retain syntax capture, type normalization, use-site rules,
 * and side-channel ownership; this function owns framework semantics only.
 */
export declare function createSpringDiMetadataAttacher<Annotation extends SpringDiAnnotationFact, SiteKind extends string>(adapter: SpringDiMetadataAdapter<Annotation, SiteKind>): (graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, indexes: ScopeResolutionIndexes) => void;
export {};
