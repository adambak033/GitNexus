import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
/**
 * Interpret a pre-decomposed Ruby import capture into a `ParsedImport`.
 *
 * Ruby `require` / `require_relative` / `load` bring everything from the
 * target file into scope (wildcard semantics). The captures layer (U5)
 * pre-decomposes the raw tree-sitter match so that this function receives:
 *   - `@import.kind`   — always `'wildcard'` for Ruby
 *   - `@import.source` — the string argument (e.g. `'./user'`, `'serializable'`)
 *   - `@import.name`   — derived module name (informational)
 */
export declare function interpretRubyImport(captures: CaptureMatch): ParsedImport | null;
/**
 * Interpret a Ruby type-binding capture into a `ParsedTypeBinding`.
 *
 * Type information in Ruby comes from YARD/RBS annotations, `.new` calls,
 * and assignment inference. The captures layer tags each match with one of
 * several sub-captures (`@type-binding.self`, `@type-binding.constructor`,
 * etc.) so this function can determine the `source`.
 */
export declare function interpretRubyTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/**
 * Normalize a Ruby type name to its simple form:
 *   1. Strip leading `::` (root-qualified)
 *   2. Take last segment of qualified paths (`Foo::Bar::Baz` → `Baz`)
 *   3. Strip generic angle brackets for consistency (`Array<User>` → `Array`)
 *   4. Trim whitespace
 */
export declare function normalizeRubyTypeName(text: string): string;
