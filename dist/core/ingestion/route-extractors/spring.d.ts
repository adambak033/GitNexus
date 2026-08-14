/**
 * Spring route annotation extractor for the ingestion pipeline.
 *
 * Extracts `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`,
 * `@PatchMapping`, and `@RequestMapping` annotations from Java source files
 * and returns `ExtractedDecoratorRoute[]` with class-level `@RequestMapping`
 * prefixes already resolved per-class.
 *
 * This module is the ingestion-layer counterpart of
 * `group/extractors/http-patterns/java.ts` (which extracts HTTP contracts
 * for cross-repo matching). It uses the same tree-sitter capture approach:
 * a single predicate-free query matches all route annotations generically,
 * then a for-loop discriminates class-level prefixes from method-level routes
 * by reading `@node.type` and the annotation name.
 *
 * The query is predicate-free to avoid the tree-sitter 0.21.x hazard where
 * `#match?` / `#eq?` predicates in a top-level `[...]` alternation silently
 * drop sibling-branch matches (see group-layer `JAVA_ROUTE_ANNOTATION_PATTERNS`
 * header comment for details).
 */
import Parser from 'tree-sitter';
import type { ExtractedDecoratorRoute } from '../workers/parse-worker.js';
import { type SharedSpringType } from './spring-shared.js';
/**
 * Extract Spring route annotations from a parsed Java file.
 *
 * Uses a single tree-sitter query pass to capture all annotations, then
 * discriminates class-level prefixes from method-level routes in a loop.
 * Handles multiple classes per file, each with its own prefix.
 *
 * @param tree - tree-sitter parse tree
 * @param filePath - relative file path (for `ExtractedDecoratorRoute.filePath`)
 * @param lineOffset - line offset for pre-processing (usually 0)
 * @returns Decorator routes with prefix already set per-class
 */
export declare function extractSpringRoutes(tree: Parser.Tree, filePath: string, lineOffset?: number): ExtractedDecoratorRoute[];
/**
 * Build the project-wide `SharedSpringType` view for one Java file: every class
 * and interface with its class prefixes, implemented interfaces, controller
 * flag, and per-method route annotations. The cross-file inheritance pass
 * (#2288) feeds these into the shared `resolveInheritedSpringRoutes` so a
 * concrete controller inherits the `@*Mapping`s declared on its interfaces.
 *
 * This is the ingestion counterpart of the group layer's `collectSpringTypes`
 * (`group/extractors/http-patterns/java.ts`); both produce the same neutral
 * shape so the two layers resolve inheritance identically (#2078 parity).
 */
export declare function extractSpringTypes(tree: Parser.Tree, filePath: string): SharedSpringType[];
