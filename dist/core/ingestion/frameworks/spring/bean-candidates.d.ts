import type { Capture, ParsedFile, ScopeId } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
export interface ClassAnnotationFact {
    readonly classScopeId: ScopeId;
    readonly annotationNames: readonly string[];
}
export interface ClassAnnotationFactStore {
    clear(): void;
    set(filePath: string, facts: readonly ClassAnnotationFact[]): void;
    get(filePath: string): readonly ClassAnnotationFact[];
}
/** Per-language store for capture facts that cross the worker boundary. */
export declare function createClassAnnotationFactStore(): ClassAnnotationFactStore;
/** Record one annotation from the language's existing scope-query traversal. */
export declare function recordClassAnnotationCapture(facts: Map<ScopeId, Set<string>>, filePath: string, classCapture: Pick<Capture, 'range'>, annotationName: string): void;
export declare function materializeClassAnnotationFacts(facts: ReadonlyMap<ScopeId, ReadonlySet<string>>): readonly ClassAnnotationFact[];
export interface SpringBeanCandidateAdapter {
    getClassAnnotationFacts(filePath: string): readonly ClassAnnotationFact[];
    isPackageVisibilityIncomplete(filePath: string): boolean;
}
type RecognizedAnnotationNames = {
    readonly has: (value: string) => boolean;
};
/** Build a scope-aware Spring annotation resolver shared by framework hooks. */
export declare function createSpringAnnotationNameResolver(indexes: ScopeResolutionIndexes): (rawName: string, parsed: ParsedFile, enclosingScope: ScopeId | null, recognizedAnnotations: RecognizedAnnotationNames, isPackageVisibilityIncomplete: boolean) => string | undefined;
/** Build a language hook that enriches Class nodes after scope resolution. */
export declare function createSpringBeanCandidateAttacher(adapter: SpringBeanCandidateAdapter): (graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, indexes: ScopeResolutionIndexes) => void;
export {};
