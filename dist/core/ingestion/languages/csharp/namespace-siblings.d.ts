/**
 * C# same-namespace cross-file visibility.
 *
 * C# makes every type declared in `namespace X` visible to every other
 * file that also declares `namespace X`, without any explicit `using`
 * directive. Python has no equivalent — every cross-file reference
 * needs an explicit import — so this is a C#-specific pass.
 *
 * Without this: `Service.cs` (namespace `FieldTypes`) can't see
 * `User` declared in `Models.cs` (same namespace), so `user.Address`
 * field-chain resolution fails at `findClassBindingInScope('User')`
 * in the Service.cs scope chain.
 *
 * Implementation: after the finalize pass populates immutable
 * `indexes.bindings` (from explicit `using` directives), walk each
 * file's tree-sitter AST for `namespace_declaration` /
 * `file_scoped_namespace_declaration` and `using_directive` nodes.
 * The orchestrator hands us its `treeCache` so files already parsed
 * by `extractParsedFile` are re-used instead of re-parsed —
 * `ParsedFile`'s underlying tree is the single source of truth.
 * Group classes by namespace, then route cross-file sibling classes
 * (and method return-type bindings) through SHARED, per-namespace
 * channels — `namespaceFqnBindings` / `namespaceTypeBindings`, keyed by
 * namespace name — populated ONCE per bucket with `origin: 'namespace'`,
 * rather than copied into every sibling's per-scope `bindingAugmentations`
 * / `Scope.typeBindings`. That per-file copy was O(files²) for a
 * concentrated namespace and OOM'd large solutions (#1871; the global
 * twin was fixed in #1905/#1954). The walkers consult these channels
 * gated by `accessibleNamespacesByScope` (a file's own namespace +
 * `using` targets), so visibility is unchanged — only the storage is
 * shared. Finalized bindings remain first in `lookupBindingsAt`, and
 * local lexical `Scope.bindings` remains the first-tier shadowing
 * channel. (`using static` member exposure still uses the per-scope
 * augmentation channel — it is per-import and not part of the blow-up.)
 *
 * The tree-sitter walk is authoritative: it sees `global using static`,
 * aliased `using static X = Y.Z;`, attributed namespace declarations,
 * and preprocessor-guarded declarations correctly because the
 * tree-sitter grammar parses them as real nodes (not textual
 * coincidences). When the orchestrator's `treeCache` has no Tree for a
 * file — the worker path, where native Trees can't cross MessageChannels
 * — `extractFileStructure` falls back to a line scanner rather than
 * re-parsing every file from scratch (that re-parse dominated worker-mode
 * scope-resolution time). See `extractCsharpStructureViaScanner`.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
export interface CsharpFileStructure {
    /** Declared namespace names in file source order. Empty array means
     *  the file has no `namespace X;` / `namespace X { }` declaration
     *  and sits in the default (global) namespace. */
    readonly namespaces: readonly string[];
    /** Dotted paths from `using static X.Y.Z;` (including
     *  `global using static` and aliased `using static A = X.Y.Z;`). */
    readonly usingStaticPaths: readonly string[];
    /** True when the scanner saw a `namespace` / `using static` declaration it
     *  could not fully capture (keyword not at line start, split across lines, or
     *  an unparseable identifier form). Callers feeding the #1881 gate must treat
     *  this like a truncated scan and fail OPEN, since a dropped namespace would
     *  otherwise over-block a legitimate import (Codex F3). Absent/false on a
     *  cleanly-scanned file. */
    readonly incomplete?: boolean;
}
/** Line-scanner used when no cached tree is available (worker-parsed files
 *  can't transfer native tree-sitter Trees across MessageChannels, so
 *  `treeCache` is empty for them). Re-parsing every C# file here with
 *  tree-sitter was the dominant scope-resolution cost on large worker-mode
 *  runs — for a multi-thousand-file solution this loop alone re-parsed the
 *  whole repo a second time. The scanner extracts the same `namespaces` /
 *  `usingStaticPaths` the AST walk produces for line-anchored declarations,
 *  while tracking block-comment and string state across lines (via
 *  `advanceCsScanState`) so a `namespace` / `using static` keyword at the
 *  start of a line inside a block comment, verbatim string, or raw string
 *  literal is NOT mistaken for a declaration. The remaining trade-off vs the
 *  AST is a declaration whose keyword is not at the start of a code line
 *  (split across lines, or sharing a line with a comment/string closer).
 *  Mirrors PHP's `extractNamespaceViaScanner` (issue #1741). */
/** Incremental form of {@link extractCsharpStructureViaScanner}: feed lines one
 *  at a time via `pushLine` (in source order), then read the accumulated
 *  structure with `result()`. Lets a caller stream a file off disk
 *  (`createReadStream` + `readline`) and scan it for `namespace` / `using
 *  static` declarations in CONSTANT memory rather than buffering the whole file
 *  into a string — the line splitting and per-line matching are identical, so a
 *  streamed scan yields the same result as scanning the full content. The line
 *  terminator must be stripped (as `readline` does, or `String.split('\n')`); a
 *  trailing `\r` on a CRLF line is inert to both the matchers and the lexer. */
export interface CsharpStructureLineScanner {
    pushLine(line: string): void;
    result(): CsharpFileStructure;
}
/** Create a fresh stateful line scanner — see {@link CsharpStructureLineScanner}. */
export declare function createCsharpStructureScanner(): CsharpStructureLineScanner;
export declare function extractCsharpStructureViaScanner(content: string): CsharpFileStructure;
/** Content + (optional) pre-parsed tree-sitter trees keyed by filePath.
 *  The orchestrator builds `fileContents` from the pipeline's file list;
 *  `treeCache` is currently always empty (its only producer, the sequential
 *  parser, was removed), so the providers re-parse. Kept as an extension
 *  point that would let cache hits avoid a second `parser.parse()`. */
export interface CsharpSiblingInputs {
    readonly fileContents: ReadonlyMap<string, string>;
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
}
/**
 * Append cross-file sibling class defs to each Namespace scope's
 * `bindingAugmentations` bucket. Class-like defs (Class / Interface /
 * Struct / Record / Enum) are visible cross-file; method / field
 * members are not.
 */
export declare function populateCsharpNamespaceSiblings(parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, inputs: CsharpSiblingInputs): void;
