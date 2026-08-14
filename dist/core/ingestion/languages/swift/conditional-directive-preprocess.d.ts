/**
 * Blank nested Swift conditional-compilation directives before parsing.
 *
 * tree-sitter-swift 0.7.1 does not admit `directive` as a `class_body` child
 * (`vendor/tree-sitter-swift/src/node-types.json`), so error recovery can
 * discard the enclosing declaration. Replacing only the directive text with
 * spaces preserves `.length`, line endings, and every declaration offset.
 *
 * ponytail: delete this file (and the `preprocessSource` wiring in `swift.ts`)
 * once a vendored tree-sitter-swift release includes upstream PR #583 ("Allow
 * #if/#elseif/#else/#endif directives inside type bodies"); see also upstream
 * issue #298 and PR #599. `.github/vendored-grammars.json` has no `"hold"` on
 * swift, so the bump bot will land that release on its own.
 *
 * A directive group is blanked only when **all** of these hold:
 *
 *   - it opens at `braceDepth > 0` — nesting, not indentation, is what the
 *     grammar rejects; top-level directives are valid source-file members and
 *     are left intact
 *   - it is not inside a multiline string literal or a block comment — blanking
 *     a line that carries a block-comment terminator would un-terminate the
 *     comment and swallow the rest of the file, and blanking inside a literal
 *     would rewrite program data
 *   - every branch is brace-balanced. A group that splits a declaration header
 *     (`#if` … `func f() async {` … `#else` … `func f() {` … `#endif`) leaves
 *     one unmatched `{` once both branches survive, which re-parents every
 *     later top-level declaration. Such a group degrades to the pre-fix
 *     behavior instead.
 *
 * Known residuals, all of which degrade to "directive left in place" rather
 * than to corrupted output: string interpolation is not parsed with full Swift
 * expression fidelity, so a nested multiline string inside an interpolation can
 * confuse the scanner; a bare `/…/` regex literal containing `/*` opens a
 * phantom block comment; and a multiline extended regex literal is treated as
 * ending at its first line.
 *
 * Byte length is *not* preserved when a blanked directive line carries
 * non-ASCII trailing text (`  #if os(iOS) // 日本語 🔥` is 23 UTF-16 code units
 * either way, but shrinks from 31 UTF-8 bytes to 23). C++ sidesteps this
 * because UE macro tokens are ASCII-only; a Swift directive line can carry any
 * trailing comment. Per the `LanguageProvider.preprocessSource` contract this is
 * safe only while no consumer slices the original UTF-8 bytes by `startIndex`:
 * node-tree-sitter reports UTF-16 code-unit indices, and every in-process
 * consumer slices the JS string, whose `.length` *is* preserved.
 *
 * Must stay pure and idempotent — see `LanguageProvider.preprocessSource`.
 */
export declare function preprocessSwiftConditionalDirectives(sourceText: string): string;
