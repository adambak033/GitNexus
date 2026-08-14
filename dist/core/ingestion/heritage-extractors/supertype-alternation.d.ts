/**
 * Shared, language-agnostic heritage supertype handling.
 *
 * Two halves of the same contract live here:
 *
 *  1. {@link buildSupertypeAlternation} — given a per-language shape descriptor
 *     (the set of tree-sitter node-type shapes a supertype can take), returns
 *     the tree-sitter S-expression alternation fragment that captures any of
 *     them under a single tag, e.g.
 *       `[(type_identifier) (generic_type) (scoped_type_identifier)] @heritage.extends`
 *     Idiomatic tree-sitter alternation is `[(a) (b) (c)]` (one-of), which the
 *     heritage query blocks in tree-sitter-queries.ts interpolate inline.
 *
 *  2. {@link normalizeSupertypeName} — given the supertype node that actually
 *     matched, reduces it to the INNERMOST simple identifier. Generics
 *     (`Base<T>`), qualified/scoped names (`pkg.Base`, `ns::Base`), and
 *     delegation wrappers (`Bar by baz`) all collapse to the bare name
 *     (`Base` / `Bar`). This mirrors the C++ registry path
 *     (languages/cpp/captures.ts `extractBaseLookupName`) so that the V1
 *     simple-name `ctx.resolve(name)` contract keeps holding for every
 *     language — no `pkg.Base` or `Base<T>` ever reaches resolution.
 *
 * No language names appear in this file. Both functions are parameterized by
 * node-type data (the descriptor and the matched node's own `.type`), per the
 * shared-ingestion rule in AGENTS.md.
 */
import type { SupertypeShapeDescriptor } from '../heritage-types.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';
/**
 * Build a tree-sitter alternation fragment capturing any of the descriptor's
 * supertype shapes under `tag`.
 *
 * A single shape produces `(shape) @tag`; multiple shapes produce the
 * bracketed one-of `[(a) (b) …] @tag`. Duplicate shapes are de-duplicated so
 * callers can compose shape lists freely. The returned string is a fragment
 * meant to be embedded inside a larger container pattern.
 */
export declare function buildSupertypeAlternation(descriptor: SupertypeShapeDescriptor, tag: string): string;
/**
 * Read-only snapshots of the four module-private node-type sets that drive
 * {@link normalizeSupertypeName}'s branch selection. Exported ONLY so a unit
 * test can enumerate the real members and assert each one still fires the
 * branch it documents — a typo'd/removed/extra member would otherwise fall
 * through silently. Not part of the runtime contract; do not consume in
 * production code.
 *
 * @internal
 */
export declare const SUPERTYPE_NODE_TYPE_SETS: {
    readonly innerNameFields: readonly ["name", "type", "property", "attribute", "value"];
    readonly leafTypes: ReadonlySet<string>;
    readonly skippedInnerTypes: ReadonlySet<string>;
    readonly leadingNameTypes: ReadonlySet<string>;
};
/**
 * Reduce a matched supertype node to its innermost simple name.
 *
 * Strategy (node-type-driven, matching the cpp reference):
 *  1. Leaf identifier types return `.text` directly.
 *  2. Try field-based access (name/type/property/attribute/value) and recurse
 *     into the first field that resolves. Some grammars expose the parts only
 *     via fields (Java generic_type→name, Go qualified_type→name, etc.).
 *  3. Leading-name wrappers ({@link LEADING_NAME_TYPES}, e.g. Kotlin
 *     `explicit_delegation` `Bar by baz`) carry the supertype as their FIRST
 *     named child and a delegate expression after it — recurse into the first
 *     child so the delegate's name never wins.
 *  4. Fall back to a children walk when fields are empty (e.g. C++
 *     qualified_identifier in 0.23.x can carry the name only as a child). The
 *     LAST named child is preferred because qualified/scoped shapes put the
 *     qualifier first and the actual name last; delegate/argument subtrees
 *     ({@link SKIPPED_INNER_TYPES}) are skipped so e.g. a Kotlin
 *     `constructor_invocation` (`Bar()`) resolves to `Bar`.
 */
export declare function normalizeSupertypeName(node: SyntaxNode | null | undefined): string;
/**
 * Best-effort textual fallback when the AST shape is unrecognized: drop any
 * generic argument list and keep the final qualified segment.
 *
 * Exported for unit coverage of the raw-name reduction (`Base<T>` → `Base`,
 * `pkg.Base` → `Base`, `ns::Base` → `Base`).
 */
export declare function simplifyRawName(text: string): string;
