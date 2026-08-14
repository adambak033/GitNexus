/**
 * Wildcard import binding synthesis.
 *
 * Languages with whole-module import semantics (Go, Ruby, C/C++, Swift)
 * import all exported symbols from a file, not specific named symbols.
 * After parsing, we know which symbols each file exports (via graph
 * `isExported`), so we can expand IMPORTS edges into per-symbol bindings
 * that the cross-file propagation phase can use for type resolution.
 *
 * Also builds Python module-alias maps for namespace-import languages
 * (`import models` → `models.User()` resolves to `models.py:User`).
 *
 * @module
 */
import type { KnowledgeGraph } from '../../graph/types.js';
import type { createResolutionContext } from '../model/resolution-context.js';
import type { SupportedLanguages } from '../../../_shared/index.js';
/** Check if a language uses wildcard (whole-module) import semantics. */
export declare function isWildcardImportLanguage(lang: SupportedLanguages): boolean;
/** Check if a language needs synthesis before call resolution.
 *  True for wildcard-import languages AND namespace-import languages (Python). */
export declare function needsSynthesis(lang: SupportedLanguages): boolean;
/**
 * Strategy implementation for `importSemantics: 'wildcard-transitive'` (C, C++).
 *
 * Textual-include languages chain symbols through files: if `dict.c` includes
 * `server.h` and `server.h` includes `dict.h`, then `dict.c` sees symbols from
 * all three files. This helper walks the include graph (combining both the
 * ingestion-context `importMap` and the graph-level IMPORTS edges) until the
 * closure is stable.
 *
 * **Order matters.** The returned `Set` preserves iteration order (insertion
 * order). `synthesizeWildcardImportBindings` dedupes bindings by symbol name
 * on a first-seen-wins basis, so this closure's ordering determines which
 * declaration wins when multiple headers export the same name (e.g. overloaded
 * free functions like `write_audit()` vs `write_audit(const char*)` in
 * different headers). We therefore:
 *   1. Seed the closure with direct imports in declaration order (matches the
 *      order of `#include` directives in the source file).
 *   2. Use FIFO / true BFS (`queue.shift()`) for transitive expansion, so
 *      closer headers are seen before deeper ones.
 *
 * Cycle-safe: the `closure.has(file)` guard prevents infinite loops on circular
 * header includes, which are valid C/C++ when paired with `#pragma once` or
 * include guards.
 *
 * Size-bounded: the closure is capped at `MAX_TRANSITIVE_CLOSURE_SIZE` files to
 * prevent OOM on pathological codebases (e.g. boost, monoheader kernel code)
 * where one translation unit can transitively reach tens of thousands of
 * headers. Partial closures still yield useful bindings for the cluster of
 * headers closest to the importer, which is what overload resolution and
 * cross-file call resolution care about.
 *
 * Queue implementation: uses a head-index over a growing array (O(1) dequeue)
 * instead of `Array.prototype.shift()` (O(n)) so deep chains stay linear.
 */
export declare function expandTransitiveIncludeClosure(directImports: Iterable<string>, importMap: ReadonlyMap<string, ReadonlySet<string>>, graphImports: ReadonlyMap<string, ReadonlySet<string>>): Set<string>;
/**
 * Synthesize namedImportMap entries for languages with whole-module imports.
 *
 * For each file that imports another file via wildcard semantics:
 * 1. Look up all exported symbols from the imported file (via graph nodes)
 * 2. Create synthetic named bindings: `{ name → { sourcePath, exportedName } }`
 * 3. Build Python module-alias maps for namespace-import languages
 *
 * @param graph  The knowledge graph with parsed symbol nodes
 * @param ctx    Resolution context with importMap and namedImportMap
 * @returns      Number of synthetic bindings created
 */
export declare function synthesizeWildcardImportBindings(graph: KnowledgeGraph, ctx: ReturnType<typeof createResolutionContext>): number;
