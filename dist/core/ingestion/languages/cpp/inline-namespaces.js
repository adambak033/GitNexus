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
import { isOverloadAmbiguousAfterNormalization, narrowOverloadCandidates, } from '../../scope-resolution/passes/overload-narrowing.js';
import { isOverloadableCallable } from '../../utils/callable-labels.js';
import { isSemanticModelValidatorEnabled } from '../../utils/env.js';
import { CPP_CONVERSION_ONLY_ARG_TYPE_PREFIXES, cppConversionRank } from './conversion-rank.js';
const inlineNamespaceRangesByFile = new Map();
const inlineNamespaceScopeIds = new Set();
/** Bumped by every writer of {@link inlineNamespaceScopeIds}. The qualified-ns
 *  index is a function of both `parsedFiles` and that Set; its WeakMap key sees
 *  only the first, so the memo stamps this epoch and a missed
 *  {@link clearCppInlineNamespaces} degrades to a rebuild, not a stale answer. */
let inlineNamespaceEpoch = 0;
function rangeKey(r) {
    return `${r.startLine}:${r.startCol}:${r.endLine}:${r.endCol}`;
}
/** Capture-time: record a namespace_definition's range as inline.
 *  Called from `emitCppScopeCaptures` when the tree-sitter AST shows an
 *  `inline` keyword child on `namespace_definition`. */
export function markCppInlineNamespaceRange(filePath, range) {
    let set = inlineNamespaceRangesByFile.get(filePath);
    if (set === undefined) {
        set = new Set();
        inlineNamespaceRangesByFile.set(filePath, set);
    }
    set.add(rangeKey(range));
}
/** Snapshot this file's captured inline-namespace ranges for the worker→main
 *  side-channel (#1983). `populateCppInlineNamespaceScopes` (in `populateOwners`)
 *  later resolves these range keys to ScopeIds on the main thread, so only the
 *  capture-time ranges need to cross the boundary. Returns the rangeKey strings
 *  as a plain array (empty when this file recorded none). */
export function collectCppInlineNamespaceSideChannel(filePath) {
    const set = inlineNamespaceRangesByFile.get(filePath);
    return set === undefined ? [] : [...set];
}
/** Restore this file's captured inline-namespace ranges from the side-channel. */
export function applyCppInlineNamespaceSideChannel(filePath, ranges) {
    if (ranges.length === 0)
        return;
    let set = inlineNamespaceRangesByFile.get(filePath);
    if (set === undefined) {
        set = new Set();
        inlineNamespaceRangesByFile.set(filePath, set);
    }
    for (const r of ranges)
        set.add(r);
}
/** Clear all inline-namespace state. Called from
 *  `cppScopeResolver.loadResolutionConfig` at the start of every pass.
 *
 *  The qualified-namespace index is dropped by REASSIGNING a fresh `WeakMap`
 *  (`WeakMap` has no `.clear()`) so its entries — and the `SymbolDefinition`
 *  references they hold — are released here rather than waiting on the key.
 *  Correctness does not rest on that: {@link inlineNamespaceEpoch} invalidates
 *  any surviving entry. */
export function clearCppInlineNamespaces() {
    inlineNamespaceRangesByFile.clear();
    inlineNamespaceScopeIds.clear();
    inlineNamespaceEpoch++;
    qualifiedNsIndexByPass = new WeakMap();
}
/** Resolve captured ranges to actual ScopeIds by matching scope ranges
 *  against the inline-namespace ranges recorded for this file. Run from
 *  the cpp resolver's `populateOwners` hook so the per-pipeline Set is
 *  populated before any resolution pass consults it. */
export function populateCppInlineNamespaceScopes(parsed) {
    const ranges = inlineNamespaceRangesByFile.get(parsed.filePath);
    if (ranges === undefined || ranges.size === 0)
        return;
    inlineNamespaceEpoch++;
    for (const scope of parsed.scopes) {
        if (scope.kind !== 'Namespace')
            continue;
        if (ranges.has(rangeKey(scope.range))) {
            inlineNamespaceScopeIds.add(scope.id);
        }
    }
}
/** Predicate consumed by `populateCppNonGloballyVisible` to exempt
 *  inline-namespace members from cross-file unqualified-lookup
 *  exclusion (they remain reachable as if declared at the enclosing
 *  namespace's level). */
export function isCppInlineNamespaceScope(scopeId) {
    return inlineNamespaceScopeIds.has(scopeId);
}
/**
 * Dev/test-only mutation tripwire on the arrays this module shares across call
 * sites ({@link NO_DEFS} and every `membersByReceiver` memo entry): an in-place
 * `.sort()`/`.splice()` ever added to `overload-narrowing.ts` would corrupt
 * every LATER resolution of the same pair, not just its own call, and freezing
 * makes that a loud `TypeError` instead. DEV-ONLY because the types already
 * reject it — the memo and `narrowOverloadCandidates`' parameter are both
 * `readonly SymbolDefinition[]`, so only a cast gets past — while the freeze is
 * not free: V8 moves a frozen array to `PACKED_FROZEN_ELEMENTS`, off the
 * builtin fast path for the `.filter`/`.map`/`.some` narrowing runs over it at
 * every multi-candidate call site (measured 4.6×; large bench arm 100.3 → 70.6ms
 * with it off). Gated on `isSemanticModelValidatorEnabled()` — the OPT-IN form,
 * not `adl.ts`'s opt-out `NODE_ENV !== 'production'`: `NODE_ENV` is unset in a
 * CLI `analyze`, so the opt-out form would keep paying the freeze exactly where
 * the cost lands. Read once at load because this one is per-call-site.
 */
const FREEZE_SHARED_CANDIDATES = isSemanticModelValidatorEnabled();
/** Shared empties: most namespace scopes declare no callables, and most
 *  qualified receivers name no namespace at all. `NO_DEFS` is process-wide, so
 *  it gets the same dev-only freeze the memoized arrays do. */
const NO_MEMBERS = new Map();
const NO_DEFS = FREEZE_SHARED_CANDIDATES ? Object.freeze([]) : [];
/** Simple (last-segment) name of a def, matching the legacy scan exactly —
 *  including the empty-string fallback for a def with no `qualifiedName`, and
 *  the empty last segment of a trailing-dot name. `lastIndexOf` + `slice`
 *  rather than `split('.').pop()`: same result, no intermediate array, and this
 *  runs per callable def and per namespace scope at build. */
function simpleNameOf(def) {
    const qualified = def.qualifiedName;
    if (qualified == null)
        return '';
    const lastDot = qualified.lastIndexOf('.');
    return lastDot === -1 ? qualified : qualified.slice(lastDot + 1);
}
/**
 * Per-pass memo: `parsedFiles` array identity → the built index. `WeakMap`-keyed
 * so the entry lives only as long as the caller's `parsedFiles` array does, and
 * is reclaimed with the pass — mirrors `moduleScopeIndexByPass` in
 * `file-local-linkage.ts`.
 *
 * Weak keying is load-bearing, not stylistic: the index holds
 * `SymbolDefinition` references reaching into every ParsedFile's scopes, so a
 * module-level strong `let` pair (index + source array) kept the whole C/C++
 * ParsedFile set alive past the point `scope-resolution/pipeline/phase.ts`
 * evicts `files`/`contents`/`preExtractedByPath` and calls `forceGc()` to
 * reclaim it — C++ is 7th of 16 `SCOPE_RESOLVERS` entries, so the retention
 * survived nine later language passes plus emit (104.2 MB measured).
 */
let qualifiedNsIndexByPass = new WeakMap();
/** Build the index in two linear passes per file: one to make a node per
 *  `Namespace` scope, one to link inline children and register receivers.
 *  Linking needs both endpoints to exist and `parsed.scopes` does not promise
 *  parents precede children, hence two passes rather than one — but only the
 *  first pass filters `parsed.scopes`; it hands the second the `[scope, node]`
 *  pairs it already found. */
function buildQualifiedNsMemberIndex(parsedFiles) {
    const rootsByReceiver = new Map();
    for (const parsed of parsedFiles) {
        const nodesByScope = new Map();
        const namespaces = [];
        for (const sc of parsed.scopes) {
            if (sc.kind !== 'Namespace')
                continue;
            const node = { ownMembers: bucketOwnMembers(sc), inlineChildren: [] };
            nodesByScope.set(sc.id, node);
            namespaces.push([sc, node]);
        }
        for (const [sc, node] of namespaces) {
            // A non-`Namespace` parent (a Module scope, say) has no node, so the
            // inline child links to nothing — hence the `?.` below.
            if (sc.parent !== null && inlineNamespaceScopeIds.has(sc.id)) {
                nodesByScope.get(sc.parent)?.inlineChildren.push(node);
            }
            const nsDef = findNamespaceDefInScope(sc);
            if (nsDef === undefined)
                continue;
            const nsName = simpleNameOf(nsDef);
            let roots = rootsByReceiver.get(nsName);
            if (roots === undefined) {
                roots = [];
                rootsByReceiver.set(nsName, roots);
            }
            roots.push(node);
        }
    }
    return { rootsByReceiver, membersByReceiver: new Map() };
}
/** Bucket a namespace scope's own callable `ownedDefs` by member simple name.
 *  No descent: inline children are separate nodes reached by the walk. */
function bucketOwnMembers(scope) {
    let members;
    for (const def of scope.ownedDefs) {
        if (!isOverloadableCallable(def.type))
            continue;
        const simple = simpleNameOf(def);
        members ??= new Map();
        let arr = members.get(simple);
        if (arr === undefined) {
            arr = [];
            members.set(simple, arr);
        }
        arr.push(def);
    }
    return members ?? NO_MEMBERS;
}
/** Candidates for `receiver::member`, memoized on the index per pair so a
 *  repeated call site costs two Map lookups. */
function qualifiedNsMembers(index, receiverName, memberName) {
    const roots = index.rootsByReceiver.get(receiverName);
    // No namespace by that name — the most common outcome in real source. Left
    // unmemoized deliberately: it is already O(1), and memoizing would grow the
    // index by an entry per unresolved receiver name in the workspace.
    if (roots === undefined)
        return NO_DEFS;
    let byMember = index.membersByReceiver.get(receiverName);
    if (byMember === undefined) {
        byMember = new Map();
        index.membersByReceiver.set(receiverName, byMember);
    }
    let hits = byMember.get(memberName);
    if (hits === undefined) {
        // Memoization makes this array shared by every call site in the pass rather
        // than rebuilt per call, so it carries the dev-only mutation tripwire (see
        // {@link FREEZE_SHARED_CANDIDATES}).
        hits = gatherQualifiedNsMember(roots, memberName);
        if (FREEZE_SHARED_CANDIDATES)
            hits = Object.freeze(hits);
        byMember.set(memberName, hits);
    }
    return hits;
}
/** Pre-order depth-first walk of every scope named `receiverName` and its
 *  transitive inline-namespace children, collecting callables named
 *  `memberName` — the index twin of the legacy
 *  `findMemberInNamespaceTransitive`.
 *
 *  Iterative, not recursive: nesting depth is whatever the input file says, and
 *  a recursive descent threw `RangeError` past ~8k levels (see
 *  {@link QualifiedNsMemberIndex}). */
function gatherQualifiedNsMember(roots, memberName) {
    const hits = [];
    const stack = [];
    // `visited` spans ALL roots, reproducing the legacy per-receiver `seenNodeId`
    // dedup: `namespace ns { inline namespace ns { … } }` registers both scopes
    // under receiver `ns`, and the outer walk already collected the inner's defs.
    // Node identity is equivalent to the legacy nodeId key because a node always
    // contributes the same defs. It doubles as the guard that a malformed parent
    // cycle terminates instead of spinning — the one regression an explicit stack
    // could otherwise introduce over recursion's `RangeError`.
    const visited = new Set();
    for (const root of roots) {
        stack.push(root);
        while (stack.length > 0) {
            const node = stack.pop();
            if (visited.has(node))
                continue;
            visited.add(node);
            const own = node.ownMembers.get(memberName);
            if (own !== undefined)
                for (const def of own)
                    hits.push(def);
            // Reverse push so children pop in declaration order — the legacy walk's
            // pre-order depth-first candidate order (see
            // {@link QualifiedNsMemberIndex.rootsByReceiver}).
            const kids = node.inlineChildren;
            for (let i = kids.length - 1; i >= 0; i--)
                stack.push(kids[i]);
        }
    }
    return hits.length === 0 ? NO_DEFS : hits;
}
/** Build the index on first use of a given `parsedFiles` set; reuse it for
 *  every subsequent call site that passes the same array reference AND the same
 *  {@link inlineNamespaceEpoch}.
 *
 *  Both keys are needed because the index is a function of TWO inputs:
 *  `parsedFiles` and the module-level `inlineNamespaceScopeIds` (which inline
 *  children get descended into). A later pass may hand back the same
 *  `parsedFiles` reference with different inline-namespace state, so identity
 *  alone would serve a stale index — the epoch is what makes that a checked
 *  rebuild instead of a documented obligation on the clear site.
 *
 *  Lifetime: the entry is reachable only while the caller still holds the
 *  `parsedFiles` array; nothing here pins it (see {@link qualifiedNsIndexByPass}).
 *
 *  Same STALENESS contract as `ensureAdlIndex` in `adl.ts`, minus that
 *  sibling's dev-gated `validateAdlSeqCoverage` guard: this index has no `?? 0`
 *  defaulting read to silently collide on, so there is nothing for such a guard
 *  to catch. */
function qualifiedNsMemberIndex(parsedFiles) {
    const memo = qualifiedNsIndexByPass.get(parsedFiles);
    if (memo !== undefined && memo.epoch === inlineNamespaceEpoch)
        return memo.index;
    const index = buildQualifiedNsMemberIndex(parsedFiles);
    qualifiedNsIndexByPass.set(parsedFiles, { epoch: inlineNamespaceEpoch, index });
    return index;
}
/** Constant narrowing hooks for the C++ qualified-receiver path — hoisted so
 *  the literal is not reallocated at every multi-candidate call site. */
const CPP_NARROWING_HOOKS = {
    conversionRankFn: cppConversionRank,
    conversionOnlyArgTypePrefixes: CPP_CONVERSION_ONLY_ARG_TYPE_PREFIXES,
};
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
export function resolveCppQualifiedNamespaceMember(receiverName, memberName, parsedFiles, _scopes, callsite) {
    const allHits = qualifiedNsMembers(qualifiedNsMemberIndex(parsedFiles), receiverName, memberName);
    if (allHits.length === 0)
        return undefined;
    if (allHits.length === 1)
        return allHits[0];
    // Multi-candidate: thread call-site arity/argument-types through the
    // `resolveQualifiedReceiverMember` contract so `narrowOverloadCandidates`
    // can disambiguate via exact-type match and, when available, conversion-rank
    // scoring (`cppConversionRank`). Same-signature ambiguity is still detected
    // by `isOverloadAmbiguousAfterNormalization` below.
    const narrowed = narrowOverloadCandidates(allHits, callsite?.arity, callsite?.argumentTypes, callsite !== undefined ? CPP_NARROWING_HOOKS : undefined);
    if (narrowed.length === 1)
        return narrowed[0];
    if (narrowed.length === 0)
        return undefined;
    if (isOverloadAmbiguousAfterNormalization(narrowed, undefined))
        return 'ambiguous';
    // Multiple surviving candidates (distinct signatures) — conservative
    // suppress because we lack call-site info to disambiguate.
    return 'ambiguous';
}
function findNamespaceDefInScope(scope) {
    for (const def of scope.ownedDefs) {
        if (def.type === 'Namespace')
            return def;
    }
    return undefined;
}
