/**
 * `emitScopeCaptures` for Swift.
 *
 * Drives the Swift scope query against tree-sitter-swift and groups raw
 * matches into `CaptureMatch[]` for the central extractor. Synthesizes
 * several streams on top of the raw query captures:
 *
 *   1. **Decomposed imports** — each `import_declaration` is re-emitted
 *      with `@import.kind/source/name` markers (and `@import.testable`
 *      when present) so `interpretSwiftImport` recovers the ParsedImport
 *      shape without re-parsing raw text (`import-decomposer.ts`).
 *   2. **Optional bindings** — `if let u = getUser()` / `guard let …`
 *      synthesize a `@type-binding.constructor` (name → callee) by
 *      walking the anchored statement (`@optional.binding`).
 *   3. **Receiver bindings** — `self` (+ `super`) `@type-binding.self`
 *      anchors on every instance method/init (`receiver-binding.ts`).
 *   4. **Signature bindings** — parameter-type and return-type
 *      `@type-binding.*` synthesized from the function node, because
 *      Swift's grammar reuses the `name:` field for func-name / param /
 *      return so a query can't disambiguate (`signature-bindings.ts`).
 *   5. **Arity metadata** — `@declaration.parameter-count` etc. on
 *      function-like declarations and `@reference.arity` on call sites,
 *      so the registry can narrow by arity (`arity-metadata.ts`).
 *
 * Extension handling: a `class_declaration` whose `name:` is a
 * `(user_type …)` is an `extension Foo { … }`. The query tags it
 * `@declaration.extension`; we re-key it to `@declaration.class` with a
 * synthesized `@declaration.name` of the extended type so its members
 * hoist onto `Foo`'s scope (`populateClassOwnedMembers` completes the
 * ownership stamp) — the same mechanism C# uses for `partial class`.
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
export declare function emitSwiftScopeCaptures(sourceText: string, _filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
