/**
 * `emitScopeCaptures` for PHP (RFC #909 Ring 3 LANG-php).
 *
 * Drives the PHP scope query against tree-sitter-php and groups raw
 * matches into `CaptureMatch[]` for the central extractor. Layers two
 * synthesized streams on top:
 *
 *   1. **Decomposed use declarations** — each `namespace_use_declaration`
 *      is re-emitted with `@import.kind/source/name/alias` markers so
 *      `interpretPhpImport` can recover the ParsedImport shape without
 *      re-parsing raw text. Grouped uses fan out to one match per clause.
 *
 *   2. **Receiver-binding synthesis** — `$this` and `parent` type-bindings
 *      are synthesized on every non-static method entry. PHP's grammar
 *      does not express "implicit receiver of a non-static class method"
 *      via a clean `.scm` pattern, so we walk up the AST in code.
 *
 *   3. **Arity metadata synthesis** — `@declaration.parameter-count` /
 *      `@declaration.required-parameter-count` / `@declaration.parameter-types`
 *      are synthesized on function-like declarations so the registry can
 *      narrow overloads.
 *
 *   4. **PHPDoc synthesis** — @param and @return annotations in comment
 *      nodes preceding method/function declarations are extracted and emitted
 *      as `@type-binding.parameter` and `@type-binding.return` matches.
 *
 *   5. **Foreach loop synthesis** — `foreach ($users as $user)` emits
 *      a `@type-binding.alias` match binding the loop variable to the
 *      element type of the iterable (resolved from PHPDoc or scopeEnv).
 *
 *   6. **PHPDoc `@var` property synthesis** — a docblock on an UNTYPED
 *      property emits the `@type-binding.annotation` + `@declaration.property`
 *      pair the native typed-property rules emit, which is the only way PHP
 *      can declare a generic field type (#2833).
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
export declare function emitPhpScopeCaptures(sourceText: string, _filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
