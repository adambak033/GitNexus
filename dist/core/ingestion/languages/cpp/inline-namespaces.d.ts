/**
 * C++ inline namespace support (U5 of plan 2026-05-13-001).
 *
 * `inline namespace v1 { void foo(); }` has two ISO C++ semantics that
 * GitNexus must model:
 *
 *   1. **Transitive unqualified visibility.** Names declared in an inline
 *      namespace are reachable by unqualified lookup from the enclosing
 *      namespace's scope, as if they were declared directly there.
 *      `populateCppNonGloballyVisible` (file-local-linkage.ts) treats
 *      inline-namespace members as globally visible for cross-file
 *      unqualified lookup.
 *
 *   2. **Transitive qualified visibility.** `outer::foo()` resolves to
 *      `outer::v1::foo()` when `v1` is inline. The qualified-namespace
 *      receiver resolver (`resolveCppQualifiedNamespaceMember`) walks
 *      inline-namespace children transitively when collecting candidates —
 *      once per pipeline run, into {@link QualifiedNsMemberIndex} (#2788).
 *
 * State lifecycle: capture-time `markCppInlineNamespaceRange` records each
 * inline namespace's source range; `populateCppInlineNamespaceScopes`
 * resolves ranges to `ScopeId`s during `populateOwners`. Cleared via
 * `clearCppInlineNamespaces`, called from
 * `cppScopeResolver.loadResolutionConfig` at the start of every pass.
 *
 * STL idiom this enables: `std::__1::vector` (libc++) and `std::__cxx11`
 * (libstdc++) are inline namespaces of `std`. With this support,
 * `std::vector` qualified calls resolve to the inline-namespace
 * declaration transparently.
 */
import type { Callsite, ParsedFile, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
interface RangeKey {
    readonly startLine: number;
    readonly startCol: number;
    readonly endLine: number;
    readonly endCol: number;
}
/** Capture-time: record a namespace_definition's range as inline.
 *  Called from `emitCppScopeCaptures` when the tree-sitter AST shows an
 *  `inline` keyword child on `namespace_definition`. */
export declare function markCppInlineNamespaceRange(filePath: string, range: RangeKey): void;
/** Snapshot this file's captured inline-namespace ranges for the worker→main
 *  side-channel (#1983). `populateCppInlineNamespaceScopes` (in `populateOwners`)
 *  later resolves these range keys to ScopeIds on the main thread, so only the
 *  capture-time ranges need to cross the boundary. Returns the rangeKey strings
 *  as a plain array (empty when this file recorded none). */
export declare function collectCppInlineNamespaceSideChannel(filePath: string): readonly string[];
/** Restore this file's captured inline-namespace ranges from the side-channel. */
export declare function applyCppInlineNamespaceSideChannel(filePath: string, ranges: readonly string[]): void;
/** Clear all inline-namespace state. Called from
 *  `cppScopeResolver.loadResolutionConfig` at the start of every pass.
 *
 *  The qualified-namespace index is dropped by REASSIGNING a fresh `WeakMap`
 *  (`WeakMap` has no `.clear()`) so its entries — and the `SymbolDefinition`
 *  references they hold — are released here rather than waiting on the key.
 *  Correctness does not rest on that: {@link inlineNamespaceEpoch} invalidates
 *  any surviving entry. */
export declare function clearCppInlineNamespaces(): void;
/** Resolve captured ranges to actual ScopeIds by matching scope ranges
 *  against the inline-namespace ranges recorded for this file. Run from
 *  the cpp resolver's `populateOwners` hook so the per-pipeline Set is
 *  populated before any resolution pass consults it. */
export declare function populateCppInlineNamespaceScopes(parsed: ParsedFile): void;
/** Predicate consumed by `populateCppNonGloballyVisible` to exempt
 *  inline-namespace members from cross-file unqualified-lookup
 *  exclusion (they remain reachable as if declared at the enclosing
 *  namespace's level). */
export declare function isCppInlineNamespaceScope(scopeId: ScopeId): boolean;
/**
 * Find the Namespace scopes whose simple name matches `receiverName` and
 * return their callable members matching `memberName`, transitively
 * including inline-namespace children (since they're members of the
 * enclosing namespace under ISO C++). Served from a per-pipeline index
 * ({@link QualifiedNsMemberIndex}), not a per-call-site workspace scan.
 *
 * Returns the most specific (innermost) match — for `outer::foo()`
 * where `inline namespace v1` declares `foo`, returns `v1::foo`. When
 * multiple inline-namespace children declare the same name, ISO C++
 * leaves the call ambiguous; returns `'ambiguous'` so the caller
 * suppresses edge emission rather than picking arbitrarily (#1564).
 *
 * Two production call sites, both in `scope-resolver.ts`:
 *   - `resolveQualifiedReceiverMember` — the `outer::foo()` qualified-receiver
 *     hook. Passes `callsite`, so a multi-candidate set can be narrowed by
 *     arity and argument types.
 *   - `resolveAdlCandidates` — resolving a `using ns::name;` named import back
 *     to its namespace member, for template-class method bodies where the
 *     lexical walk misses that visibility. Passes NO `callsite`, which makes
 *     the narrowing filters below pass-throughs: on that path any receiver
 *     whose member has more than one candidate returns `'ambiguous'` (and the
 *     caller then skips it) rather than being disambiguated.
 */
export declare function resolveCppQualifiedNamespaceMember(receiverName: string, memberName: string, parsedFiles: readonly ParsedFile[], _scopes: ScopeResolutionIndexes, callsite?: Callsite): SymbolDefinition | 'ambiguous' | undefined;
export {};
