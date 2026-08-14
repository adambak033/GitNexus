/**
 * Heritage Processor
 *
 * Extracts class inheritance relationships:
 * - EXTENDS: Class extends another Class (TS, JS, Python, C#, C++)
 * - IMPLEMENTS: Class implements an Interface (TS, C#, Java, Kotlin, PHP)
 *
 * Languages like C# use a single `base_list` for both class and interface parents.
 * We resolve the correct edge type by checking the symbol table: if the parent is
 * registered as an Interface, we emit IMPLEMENTS; otherwise EXTENDS. For unresolved
 * external symbols, the fallback heuristic is language-gated:
 *   - C# / Java: apply the `I[A-Z]` naming convention (e.g. IDisposable → IMPLEMENTS)
 *   - Swift: default to IMPLEMENTS (protocol conformance is more common than class inheritance)
 *   - All other languages: default to EXTENDS
 */
import { KnowledgeGraph } from '../graph/types.js';
import { ASTCache } from './ast-cache.js';
import type { ExtractedHeritage, HeritageStrategyLookup } from './model/heritage-map.js';
import type { ResolutionContext } from './model/resolution-context.js';
/**
 * Derive the heritage-resolution strategy for a language from its
 * `LanguageProvider`. This is the production wiring that `buildHeritageMap`
 * and the standalone `resolveExtendsType` call site use — the model layer
 * itself stays unaware of the provider registry.
 */
export declare const getHeritageStrategyForLanguage: HeritageStrategyLookup;
export declare const processHeritage: (graph: KnowledgeGraph, files: {
    path: string;
    content: string;
}[], astCache: ASTCache, ctx: ResolutionContext, onProgress?: (current: number, total: number) => void) => Promise<void>;
/**
 * Fast path: resolve pre-extracted heritage from workers.
 * No AST parsing — workers already extracted className + parentName + kind.
 */
export declare const processHeritageFromExtracted: (graph: KnowledgeGraph, extractedHeritage: ExtractedHeritage[], ctx: ResolutionContext, onProgress?: (current: number, total: number) => void) => Promise<void>;
/**
 * Walk source files with the same heritage captures as parse-worker, producing
 * {@link ExtractedHeritage} rows without mutating the graph. Used on the
 * sequential pipeline path so `buildHeritageMap(..., ctx)` can run before
 * `processCalls` (worker path defers calls until heritage from all chunks exists).
 *
 * This prepass extracts BOTH capture-based heritage (`@heritage.*` — extends /
 * implements / trait-impl) AND call-based heritage (`@call.name` routed through
 * `heritageExtractor.extractFromCall` — Ruby `include` / `extend` / `prepend`).
 * Without the second pass, sequential-mode `sequentialHeritageMap` would not
 * know about Ruby mixin ancestry before `processCalls` resolves calls against
 * it, silently dropping mixed-in methods from the graph. This function stays
 * read-only — `processCalls` still owns emission of heritage graph edges via
 * its `rubyHeritage` return path.
 */
export declare function extractExtractedHeritageFromFiles(files: {
    path: string;
    content: string;
}[], astCache: ASTCache): Promise<ExtractedHeritage[]>;
