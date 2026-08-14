/**
 * C++ argument-dependent lookup (ADL / Koenig lookup).
 *
 * When ordinary unqualified lookup fails for a free-call site, ADL also
 * considers candidates declared in the **associated namespaces** of the
 * call's argument types (ISO C++ `[basic.lookup.argdep]`). The canonical
 * pattern V1 unlocks:
 *
 *   namespace audit { struct Event; void record(Event); }
 *   namespace app   { void run() { audit::Event e; record(e); } }
 *
 * Without ADL: `record(e)` is unresolved because `app::run` doesn't
 * `using` anything. With V1 ADL: `audit::record` is discovered via
 * `audit::Event`'s associated namespace.
 *
 * ## Current boundary
 *
 * The current implementation covers class-typed arguments (value, pointer,
 * and reference) and template specializations with explicit type arguments:
 *   - `audit::Event e`, `audit::Event* p`, `audit::Event** pp`
 *   - `audit::Event& r`, `audit::Event&& rr`
 *   - `std::vector<audit::Event>` (template namespace + template-arg namespaces)
 *
 * V2 additionally walks class ancestors (via MRO), so base-class enclosing
 * namespaces also contribute associated namespaces.
 *
 * Function-reference arguments follow ISO C++ `[basic.lookup.argdep]`:
 * associated entities come from the parameter types and return type of each
 * referenced function in the overload set, not from the function's enclosing
 * namespace. For `void worker()`, the associated set is empty. For
 * `void worker(api::Token)` or `api::Token make_token()`, `api` is associated
 * through `Token`.
 *
 * For qualified refs (e.g. `utils::worker`) the workspace lookup is restricted
 * to functions/methods named `worker` in `utils`; for unqualified refs the
 * workspace is searched for matching functions/methods by simple name. Locally
 * declared function-pointer variables and function parameters are excluded
 * from this path.
 *
 * ADL candidates are merged with ordinary unqualified-lookup candidates
 * in the free-call fallback before overload narrowing.
 *
 * ## Parenthesized-name suppression
 *
 * `(f)(s)` MUST NOT trigger ADL — the parenthesized name forces ordinary
 * lookup only. `captures.ts` records sites whose `function` child is a
 * `parenthesized_expression` into `noAdlSites`; `pickCppAdlCandidates`
 * short-circuits when the site key is present.
 *
 * ## State lifecycle
 *
 * Five pieces of module-level state populated per pipeline invocation, all
 * reset together by `clearCppAdlState()` (called from
 * `cppScopeResolver.loadResolutionConfig`, alongside `clearFileLocalNames` —
 * NOT from `clearFileLocalNames` itself), grouped by when they fill:
 *
 *   - `argInfoBySite` — per-call-site argument shape (capture-time)
 *   - `noAdlSites` — call sites with parenthesized function (capture-time)
 *   - `classToNamespaceQualifiedName` — class def → its enclosing namespace
 *     qualified name (`populateCppAssociatedNamespaces` time)
 *   - `adlIndexByPass` — the lazily-built candidate index, memoized weakly on
 *     the `parsedFiles` array it was built from (first-`pickCppAdlCandidates`
 *     time; see `ensureAdlIndex`)
 *
 * The class→namespace map uses qualified names (not scope IDs) because
 * C++ namespaces are open: `namespace N { ... }` in file A and
 * `namespace N { ... }` in file B produce two distinct Namespace scopes
 * but logically share the same namespace. ADL must consider candidates
 * declared in either file.
 */
import type { ParsedFile, SymbolDefinition } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
/**
 * Per-argument shape information collected at capture time. ADL fires for
 * arguments where `simpleClassName !== ''`, including class pointers and
 * references whose declarator chain resolves to a named class type.
 * Free-function reference arguments use `functionRefText`.
 */
export interface CppAdlArgInfo {
    /** Simple class-like type name (last segment of qualified name); empty
     *  for primitives, literals, function pointers, etc. */
    readonly simpleClassName: string;
    /** Template's own simple class-like name (e.g. `vector` for
     *  `std::vector<N::T>`), empty when arg type is not a template spec. */
    readonly templateSimpleClassName: string;
    /** Template's own enclosing namespace (dot-qualified, e.g. `std`), empty
     *  when unavailable / unqualified. */
    readonly templateNamespace: string;
    /** Class-like names extracted from explicit type template arguments,
     *  recursively bounded. */
    readonly templateArgClassNames: readonly string[];
    /** Enclosing namespaces extracted from explicit type template arguments,
     *  recursively bounded. */
    readonly templateArgNamespaces: readonly string[];
    /** When set, the arg is a potential free-function reference (not a locally-
     *  declared function-pointer variable or function parameter). Contains the
     *  identifier text as written in source (e.g. `"utils::worker"` or
     *  `"worker"`). Resolution contributes associated namespaces from each
     *  referenced Function/Method def's parameter and return types. */
    readonly functionRefText?: string;
}
/**
 * ADL candidate index — built **once** per pipeline run from
 * `(scopes, parsedFiles)` and reused by every call site.
 *
 * The legacy `pickCppAdlCandidates` re-scanned all parsed files (rebuilding a
 * per-file `scopesById` map each time), all workspace defs (for the
 * class-by-simple-name lookup), and used an O(scopes²) child-scope walk for
 * hidden friends — once **per unresolved call site**. With hundreds of
 * thousands of unresolved C++ sites that made the scope-resolution emit phase
 * super-linear (observed ~6.7h on a large repo). This index moves all of that
 * work to a single pass; per-site cost drops to O(associated namespaces).
 */
export interface AdlCandidateIndex {
    /** simple name → class-like defs (Class/Struct/Interface/Enum), preserving
     *  `scopes.defs.byId` iteration order so first-match / ambiguous semantics
     *  match the legacy linear scan. */
    readonly classDefsBySimple: Map<string, SymbolDefinition[]>;
    /** namespace QName → simple name → callable defs owned by that namespace,
     *  with inline-namespace transparency (inline-ns defs are also registered
     *  under the parent namespace's QName). */
    readonly nsCandidates: Map<string, Map<string, SymbolDefinition[]>>;
    /** associated-class enclosing-namespace QName → simple name → hidden-friend
     *  and class-member callable defs. */
    readonly friendCandidates: Map<string, Map<string, SymbolDefinition[]>>;
    /** namespace QName (own) → simple name → Function/Method defs, for the
     *  qualified function-reference ADL path. */
    readonly nsFunctionsByQName: Map<string, Map<string, SymbolDefinition[]>>;
    /** simple name → Function/Method defs across all namespaces, for the
     *  unqualified function-reference ADL path. */
    readonly nsFunctionsBySimple: Map<string, SymbolDefinition[]>;
    /** nodeId → visitation sequence number, used to merge per-namespace buckets
     *  back into the exact legacy candidate order (file-major; namespace defs
     *  before friend/member defs within a file). */
    readonly seqByNodeId: Map<string, number>;
}
/**
 * Return the nodeIds present in the index's candidate buckets
 * (`nsCandidates` + `friendCandidates`) but missing from `seqByNodeId`, each
 * reported once. Empty array means the seq-coverage invariant holds — which it
 * must, since `buildAdlIndex` assigns a seq to every callable def in the same
 * block that buckets it. Exported for the dev-gated guard in `buildAdlIndex`
 * and its unit test.
 */
export declare function validateAdlSeqCoverage(idx: AdlCandidateIndex): string[];
/** Record per-call-site argument info. Called once per call site from
 *  `emitCppScopeCaptures`. */
export declare function markCppAdlSiteArgs(filePath: string, line: number, col: number, args: readonly CppAdlArgInfo[]): void;
/** Mark a call site as ADL-suppressed (function child wrapped in
 *  `parenthesized_expression`, e.g. `(f)(s)`). */
export declare function markCppAdlSiteNoAdl(filePath: string, line: number, col: number): void;
/**
 * Plain-data, JSON-serializable snapshot of the per-file ADL capture state
 * (`argInfoBySite` entries for this file + `noAdlSites` keys for this file).
 * Carried on `ParsedFile.captureSideChannel` across the worker→main boundary
 * (#1983); the call-site key's `line:col` are stored per-entry so the full
 * `filePath:line:col` key can be reconstructed without parsing.
 */
export interface CppAdlSideChannel {
    /** Per-call-site arg info: `[line, col, args]` for sites in this file. */
    readonly argInfoBySite: readonly [number, number, readonly CppAdlArgInfo[]][];
    /** ADL-suppressed sites in this file: `[line, col]`. */
    readonly noAdlSites: readonly [number, number][];
}
/**
 * Snapshot this file's ADL capture state for the worker→main side-channel.
 *
 * Uses the per-file `argInfoSiteKeysByFile` / `noAdlSiteKeysByFile` indexes to
 * touch only THIS file's entries — O(entries-for-this-file) — instead of the
 * old O(all-entries) full scan over `argInfoBySite` / `noAdlSites` (#1983).
 * The output order, and therefore the serialized JSON shape, is byte-identical
 * to the old filtered scan: the index records keys in the same insertion order
 * the maps' own iteration would have yielded for this file, and each key is
 * indexed exactly once (mark guards on first insert), so the same per-file
 * subsequence is produced.
 *
 * `parseSiteKey` is still used to recover `line:col` from each key, but now
 * only for this file's keys (a bounded handful), never for the whole batch.
 */
export declare function collectCppAdlSideChannel(filePath: string): CppAdlSideChannel;
/** Restore this file's ADL capture state from the side-channel (no parse).
 *  Keeps the per-file site-key indexes in lockstep with `argInfoBySite` /
 *  `noAdlSites` (first-insert-only) so a later `collectCppAdlSideChannel` on
 *  the same process would still produce a correct, duplicate-free snapshot. */
export declare function applyCppAdlSideChannel(filePath: string, data: CppAdlSideChannel): void;
/** Clear ADL state. Called from `cppScopeResolver.loadResolutionConfig`
 *  (alongside `clearFileLocalNames`) so all C++ resolver per-pipeline state is
 *  reset together at the start of each resolution pass. */
export declare function clearCppAdlState(): void;
/**
 * Walk `parsed.scopes` to record each Class def's enclosing namespace
 * qualified name. Run from the cpp resolver's `populateOwners` hook so
 * the index is available before any resolution pass consults it.
 *
 * Computes the namespace's qualified name by walking parent scope chain
 * and looking up Namespace defs in each parent's `ownedDefs`. The
 * resulting name is dot-joined (matching `populateClassOwnedMembers`'s
 * dotted convention; conversion to `::` is consumer-internal).
 */
export declare function populateCppAssociatedNamespaces(parsed: ParsedFile): void;
/**
 * ADL candidate collector. Returns:
 *   - `readonly SymbolDefinition[]` — ADL candidates to merge with
 *     ordinary unqualified lookup candidates.
 *   - `undefined` — no ADL candidates.
 *
 * Fires only when:
 *   - the call site is not in `noAdlSites` (parenthesized form), AND
 *   - at least one argument resolves to a named class type (value,
 *     pointer, or reference; but not function pointer, literal, or primitive).
 */
export declare function pickCppAdlCandidates(site: {
    readonly name: string;
    readonly atRange: {
        startLine: number;
        startCol: number;
    };
}, callerParsed: ParsedFile, scopes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[]): readonly SymbolDefinition[] | undefined;
