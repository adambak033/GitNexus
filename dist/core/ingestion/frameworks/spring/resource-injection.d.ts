import type { DiInjectionMatch } from '../../di-extractors/index.js';
export declare const SPRING_RESOURCE_ANNOTATIONS: Set<string>;
export declare function springResourceDefaultName(siteKind: string, memberName: string, dependencyCount: number): string | null;
/** Build the conservative name-first Resource match shared by Java and Kotlin. */
export declare function springResourceInjectionMatch(annotationText: string, defaultName: string, rawDeclaredType: string, location: string): DiInjectionMatch | null;
