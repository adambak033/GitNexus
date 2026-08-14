import type { GraphRelationship, ScopeId } from '../../../../_shared/index.js';
import type { SpringDiAnnotationFact, SpringDiDependencyFact } from './di-metadata.js';
export declare const SPRING_BEAN_ANNOTATION = "org.springframework.context.annotation.Bean";
export declare const SPRING_BEAN_DECLARATION_ID_PREFIX = "CodeElement:spring-bean:";
export declare const SPRING_BEAN_FACTORY_REASON_PREFIX = "spring-bean-factory:";
export interface SpringBeanFactoryMethodFact<Annotation extends SpringDiAnnotationFact = SpringDiAnnotationFact> {
    readonly callableScopeId: ScopeId;
    readonly methodName: string;
    readonly returnType?: string;
    readonly annotations: readonly Annotation[];
    readonly dependencies: readonly SpringDiDependencyFact<Annotation>[];
}
export interface SpringBeanFactoryDeclaration {
    readonly names: readonly string[];
    readonly namesKnown: boolean;
    readonly providedType?: string;
}
export interface SpringBeanFactoryMetadata {
    readonly framework: 'spring';
    readonly role: 'factory-method';
    readonly annotation: typeof SPRING_BEAN_ANNOTATION;
    readonly names: readonly string[];
    readonly providedType?: string;
}
export declare function hasSpringBeanFactorySyntax(annotations: readonly Pick<SpringDiAnnotationFact, 'name'>[]): boolean;
/** Resolve statically readable Bean names; dynamic constants remain explicitly unknown. */
export declare function springBeanNames(annotationText: string, defaultMethodName: string): {
    readonly names: readonly string[];
    readonly namesKnown: boolean;
};
export declare function encodeSpringBeanFactoryReason(declaration: SpringBeanFactoryDeclaration): string;
export declare function decodeSpringBeanFactoryReason(reason: unknown): SpringBeanFactoryMetadata | undefined;
export declare function isSpringBeanFactoryDeclaration(relationship: Pick<GraphRelationship, 'type' | 'reason'>): boolean;
