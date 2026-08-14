import type { ParsedFile } from '../../../../_shared/index.js';
import { type ClassAnnotationFact } from '../../frameworks/spring/bean-candidates.js';
import { type JvmPackageFact } from '../jvm/package-facts.js';
import type { JavaSpringConfigConsumerFact } from './spring-config-bindings.js';
import type { JavaSpringAopFact } from './spring-aop.js';
import type { JavaSpringConditionalFact } from './spring-conditionals.js';
import type { JavaSpringDiClassFact } from './spring-di.js';
export type JavaClassAnnotationFact = ClassAnnotationFact;
export interface JavaCaptureSideChannel {
    readonly kind: 'java';
    readonly packageFact: JvmPackageFact;
    readonly classAnnotations: readonly JavaClassAnnotationFact[];
    readonly springAopFacts?: readonly JavaSpringAopFact[];
    readonly springConfigConsumers?: readonly JavaSpringConfigConsumerFact[];
    readonly springConditionalFacts?: readonly JavaSpringConditionalFact[];
    readonly springDiFacts?: readonly JavaSpringDiClassFact[];
}
/** Clear facts retained by a prior workspace pass in a long-lived process. */
export declare function clearJavaClassAnnotationFacts(): void;
export declare function setJavaSpringAopFacts(filePath: string, facts: readonly JavaSpringAopFact[]): void;
export declare function getJavaSpringAopFacts(filePath: string): readonly JavaSpringAopFact[];
/** Store the annotation syntax collected by Java's existing scope-query traversal. */
export declare function setJavaClassAnnotationFacts(filePath: string, facts: readonly JavaClassAnnotationFact[]): void;
export declare function setJavaSpringConfigConsumerFacts(filePath: string, facts: readonly JavaSpringConfigConsumerFact[]): void;
export declare function getJavaSpringConfigConsumerFacts(filePath: string): readonly JavaSpringConfigConsumerFact[];
export declare function setJavaSpringConditionalFacts(filePath: string, facts: readonly JavaSpringConditionalFact[]): void;
export declare function getJavaSpringConditionalFacts(filePath: string): readonly JavaSpringConditionalFact[];
export declare function setJavaSpringDiFacts(filePath: string, facts: readonly JavaSpringDiClassFact[]): void;
export declare function getJavaSpringDiFacts(filePath: string): readonly JavaSpringDiClassFact[];
/** Snapshot worker-local Java annotation facts for ParsedFile serialization. */
export declare function collectJavaCaptureSideChannel(filePath: string): JavaCaptureSideChannel | undefined;
export declare function getJavaClassAnnotationFacts(filePath: string): readonly JavaClassAnnotationFact[];
/** Restore worker-collected facts before Java's post-resolution hook runs. */
export declare function applyJavaCaptureSideChannel(parsed: ParsedFile): void;
