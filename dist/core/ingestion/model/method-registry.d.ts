/**
 * Method Registry
 *
 * Owner-scoped method index extracted from SymbolTable.
 * Stores Method/Constructor/Function-with-ownerId symbols keyed by
 * `ownerNodeId\0methodName` for O(1) lookup. Supports overloads
 * (array values) and arity-based filtering.
 */
import type { SymbolDefinition } from '../../../_shared/index.js';
export interface MethodRegistry {
    /**
     * Look up a method by owner class + name, optionally filtered by arity.
     *
     * When `argCount` is provided, overloads whose parameter count doesn't
     * accommodate the call's argument count are filtered out before the
     * returnType dedup runs. This lets D0 (`resolveMemberCall`) disambiguate
     * arity-differing overloads (e.g. C++ `greet()` vs `greet(string)`) that
     * would otherwise collide on the shared `ownerId + methodName` key.
     *
     * Same-arity, same-returnType overloads (e.g. `save(int)` vs `save(String)`,
     * both returning `void`) still collapse to the first match — callers must
     * gate D0 on overload concern before invoking this function for that case.
     */
    lookupMethodByOwner(ownerNodeId: string, methodName: string, argCount?: number): SymbolDefinition | undefined;
    /**
     * Flat-by-name lookup across all owners. Returns every method registered
     * with the given unqualified name, in registration order, accumulated
     * across owners and overloads.
     *
     * Required by Tier 3 global resolution: Method and Constructor do not
     * land in `SymbolTable.callableByName`, so Tier 3 reaches them through
     * this flat index instead. Returns `[]` on miss — never `undefined` —
     * so callers can concatenate without null checks.
     *
     * Reference identity: each returned def is the same object reference
     * stored under `lookupMethodByOwner`, so a method symbol occupies one
     * allocation reachable from two indexes.
     */
    lookupMethodByName(name: string): readonly SymbolDefinition[];
    /**
     * Return every overload registered under `(ownerNodeId, methodName)`,
     * unfiltered by arity or return type. This is the raw owner-scoped
     * view — callers that need arity narrowing or unambiguous single-
     * result semantics should use `lookupMethodByOwner` instead.
     *
     * Returns `[]` on miss so callers can iterate without null checks.
     */
    lookupAllByOwner(ownerNodeId: string, methodName: string): readonly SymbolDefinition[];
    /**
     * True iff at least one registered def has `type === 'Function'` — i.e.,
     * a Python/Rust/Kotlin class method emitted by the worker as
     * `Function + ownerId` rather than as a strict `Method` label. Such defs
     * are double-indexed: they land in `SymbolTable.callableByName` (via the
     * Function callable-index gate) AND in this registry (via the
     * dispatch-key normalization in `wrappedAdd`). Tier 3 resolution must
     * then dedup the two indexes by nodeId.
     *
     * When this flag is false, the callable and method indexes are
     * guaranteed disjoint and Tier 3 can skip the dedup pass entirely.
     * The flag is monotonic (false→true once, never back) for the lifetime
     * of the MethodRegistry.
     */
    readonly hasFunctionMethods: boolean;
}
export interface MutableMethodRegistry extends MethodRegistry {
    /** Register a method under its owner. Supports multiple overloads. */
    register(ownerNodeId: string, methodName: string, def: SymbolDefinition): void;
    /** Clear all entries. */
    clear(): void;
}
export declare const createMethodRegistry: () => MutableMethodRegistry;
