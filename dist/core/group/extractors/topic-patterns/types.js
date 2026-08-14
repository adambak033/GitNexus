/**
 * Shared types for the topic-extractor language plugins.
 *
 * Each plugin lives in its own file (java.ts, go.ts, ...) and owns the
 * tree-sitter grammar import + query sources. The top-level
 * `topic-extractor.ts` orchestrator only knows about this type module and
 * the plugin registry (`./index.ts`). It MUST NOT import any grammar or
 * query text directly — that's the whole point of the split.
 */
export {};
