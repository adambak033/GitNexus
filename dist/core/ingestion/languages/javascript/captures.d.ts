/**
 * `emitScopeCaptures` for JavaScript.
 *
 * Adapts `emitTsScopeCaptures` for the JavaScript grammar:
 *
 *   1. **JS grammar** — uses `tree-sitter-javascript` instead of
 *      `tree-sitter-typescript`. The JS scope query is a subset of the
 *      TypeScript one (TypeScript-only node types dropped).
 *
 *   2. **CJS `require()` decomposition** — `const { X } = require('./m')`
 *      and `const X = require('./m')` are walked in a post-query pass and
 *      synthesized as `@import.kind/name/alias/source` markers so that
 *      `interpretJsImport` can recover a `ParsedImport` using the same
 *      shape as the TypeScript ESM decomposer.
 *
 *   3. **JSDoc type bindings** — JavaScript has no static type annotations
 *      so `@type-binding.parameter` / `@type-binding.return` must be
 *      inferred from leading JSDoc comments. A lightweight regex scanner
 *      (`parseJsDocParams` / `parseJsDocReturn`) extracts `@param {T} n`
 *      and `@returns {T}` tags and emits synthetic captures positioned on
 *      the annotated function node. `@type {T}` on a class FIELD is the same
 *      story one level down — it is the only way JavaScript can declare a
 *      field's type at all — and emits `@type-binding.class-field` (#2833).
 *
 *   4. **Shared synthesis passes** — destructuring, for-of map-tuple, and
 *      instanceof narrowing passes are duplicated from `typescript/captures.ts`
 *      (they are pure AST operations with no grammar-specific logic).
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
/** JS function-like node types that may carry a synthesized `this` binding.
 *  Kept in sync with the `@scope.function` patterns in `query.ts`. */
export declare const FUNCTION_NODE_TYPES: readonly ["method_definition", "arrow_function", "function_expression", "function_declaration", "generator_function_declaration", "generator_function"];
export declare function emitJsScopeCaptures(sourceText: string, filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
