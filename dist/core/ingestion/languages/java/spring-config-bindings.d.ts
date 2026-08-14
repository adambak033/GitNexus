import type { KnowledgeGraph } from '../../../graph/types.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import { type ParsedFile, type ScopeId } from '../../../../_shared/index.js';
import { type SpringConfigConsumer } from '../../frameworks/spring/config-bindings.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
export interface JavaSpringConfigConsumerFact {
    readonly consumer: SpringConfigConsumer;
    readonly annotationName: string;
    readonly classScopeId: ScopeId;
}
/** Extract statically readable Spring placeholder keys from a Java annotation. */
export declare function parseValuePlaceholderKeys(annotation: SyntaxNode): string[];
/** Extract `prefix`/`value` (or the positional value) from the annotation. */
export declare function parseConfigurationPropertiesPrefix(annotation: SyntaxNode): string | null;
/** Collect config facts from the Java parser's existing AST (no reparse). */
export declare function captureJavaSpringConfigConsumerFacts(root: SyntaxNode, filePath: string): JavaSpringConfigConsumerFact[];
/** Parse Java consumers for focused unit tests; production reuses the worker AST. */
export declare function extractJavaSpringConfigConsumers(source: string): SpringConfigConsumer[];
/** Java ScopeResolver post-resolution hook for Spring configuration consumers. */
export declare function attachJavaSpringConfigBindings(graph: KnowledgeGraph, parsedFiles: readonly ParsedFile[], _nodeLookup: GraphNodeLookup, indexes: ScopeResolutionIndexes, _ctx: {
    readonly fileContents: ReadonlyMap<string, string>;
}): void;
