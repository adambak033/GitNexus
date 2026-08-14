/**
 * Resolve a compound-receiver expression's TYPE — `user.address.save()`,
 * `svc.get_user().save()`, `c.greet().save()` — to the class def of
 * the value the receiver expression produces.
 *
 * Three shapes (parsed C-family-style):
 *   - bare identifier `name` — look up via typeBinding chain
 *   - dotted `obj.field[.field]…` — walk fields via class-scope typeBindings
 *   - call `expr.method()` — recurse into expr, find method's return-type
 *     typeBinding on its class, resolve to a class
 *
 * **Field-fallback heuristic** (Phase-9C "unified fixpoint"): when the
 * receiver class has no `methodName`, walk its fields and try the
 * lookup on each field's type. Useful for dynamically-typed languages
 * (Python). Strictly-typed languages should pass
 * `fieldFallbackOnMethodLookup: false` via `ScopeResolver`.
 *
 * Generic for any C-family language (`.` member access, `()` call
 * syntax). Languages with non-C-family syntax (Ruby blocks, COBOL)
 * either don't trigger the call branch or skip this pass entirely.
 */
import type { ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { ElementAccessRoute, ScopeResolver } from '../contract/scope-resolver.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { WorkspaceResolutionIndex } from '../workspace-index.js';
import type { DecodedReceiverChain } from '../../utils/receiver-chain-codec.js';
import type { DecorationStripper } from '../scope/walkers.js';
/**
 * Notified with the spelling a receiver position was typed from and the class
 * it resolved to — see {@link noteReceiverType}. Pure side channel: this file
 * never reads it back, and resolution is identical whether or not it is set.
 */
type ReceiverTypeRecorder = (spelling: string, defId: string) => void;
interface ResolveCompoundReceiverOptions {
    /**
     * Optional sink for the DECLARED TYPE SPELLINGS this fold typed receiver
     * positions from (#2912). The fold returns a class, and a class has lost the
     * generic arguments that decide which implementations an interface-typed
     * receiver can dispatch to; the caller keeps the last report whose def id
     * matches the returned class and reads the arguments off that spelling.
     */
    readonly recordReceiverType?: ReceiverTypeRecorder;
    /** When true (default), if method lookup fails on the receiver's
     *  class, walk its fields and try the lookup on each field's class.
     *  Phase-9C "unified fixpoint" — Python-shaped heuristic. */
    readonly fieldFallback?: boolean;
    /** Container -> element, by subscript (`repos[0]`) or accessor (`data.Values`
     *  on a `Dictionary<K,V>` yields V). Returns the element type's simple name,
     *  or `undefined`. See the `ScopeResolver` field of the same name for why the
     *  two routes share one hook, and for why `undefined` on the `index` route
     *  means "not a container" — a step that gets it DECLINES, so a language must
     *  answer that route to get index folding at all. */
    readonly elementTypeOf?: (containerType: string, via: ElementAccessRoute) => string | undefined;
    /** Walk up from the class scope to ancestor (Module) scopes when
     *  looking up a method's return-type typeBinding. Only enable for
     *  languages that hoist return-type bindings to Module scope (C#);
     *  otherwise we risk picking up unrelated module-level bindings. */
    readonly hoistTypeBindingsToModule?: boolean;
    /** `ScopeResolver.resolveThisViaEnclosingClass` — the language declares that
     *  `this` IS the enclosing class rather than a per-function-scope binding.
     *  Read only by the `this` head seed below. */
    readonly resolveThisViaEnclosingClass?: boolean;
    /** Strip C-style cast expressions from the receiver text before
     *  resolving it (`stripCastWrappers`). Default `false` — the text
     *  reaches the resolver untouched and no cast logic runs. See the
     *  `ScopeResolver` contract toggle of the same name for the
     *  classifier grammar and per-language opt-in rules. */
    readonly stripReceiverCastExpressions?: boolean;
    /** Surface syntax this language uses to construct a value, so an
     *  inline constructor receiver can be typed. Derived from the contract
     *  rather than re-declared, so a future sub-field cannot be added there
     *  and silently ignored here (#2708). */
    readonly constructionSyntax?: ScopeResolver['constructionSyntax'];
    /** Verified namespace handles visible in the current file. */
    readonly namespaceTargets?: ReadonlyMap<string, readonly string[]>;
    /** Compact receiver chain for THIS site (`ReferenceSite.receiverChain`), when
     *  the language's capture emitter produced one. Present ⇒ the structural fold
     *  is tried before the text cascade; absent ⇒ behaviour is exactly as before.
     *  Consumed only at `depth === 0`: it describes the site's own receiver, so
     *  carrying it into a recursive call would re-fold it against an inner
     *  expression it does not describe. */
    readonly receiverChain?: string;
    /** Resolve a BARE identifier the way the dotted-chain head does: when a
     *  receiver typeBinding exists for the name, that binding decides the type and
     *  nothing else does. Off by default, so the text cascade keeps its existing
     *  (more permissive) behaviour; the structural fold turns it ON.
     *
     *  Without it, the bare-identifier branch falls through to a plain class-name
     *  lookup EVEN WHEN a binding existed but named no class — which types a local
     *  that merely SHADOWS a class as that class. That fabricated a `CALLS` edge
     *  (`const Config = make(1); Config.db.query()` emitted `entry → Database.query`),
     *  the exact wrong-edge failure this work exists to avoid. */
    readonly strictBaseBinding?: boolean;
    /** Per-language type-preserving decoration stripper, from the `ScopeResolver`
     *  contract. Passed to the class lookup at the base and step sites so a
     *  decorated declared type (`*Host`) resolves to its class. Absent for
     *  languages whose declared types carry no such decoration, and never applied
     *  by the shared lookup's other callers — see the contract's own note on why
     *  this is opt-in rather than global. */
    readonly stripTypePreservingDecoration?: DecorationStripper;
}
/**
 * Type a receiver from its decoded structure instead of from its source text.
 *
 * Resolves the base, then folds the steps base-first, each step typed against
 * the class the previous step produced. Returns `undefined` the moment any step
 * fails to type, so the caller falls back to the existing text cascade rather
 * than receiving a partially-folded guess — a missing edge is recoverable, a
 * confidently wrong one is not.
 *
 * The base is resolved by handing it to `resolveCompoundReceiverClass`, which
 * already owns the bare-identifier path in full: type binding, static
 * class-name receivers, map-tuple sentinels, member aliases and call-result
 * aliases. A second implementation of that would drift from it.
 *
 * Called from `resolveCompoundReceiverClass` ahead of the text cascade, and only
 * when the site carries a `receiverChain` (see the `depth === 0` gate below).
 */
export declare function foldReceiverChain(chain: DecodedReceiverChain, inScope: ScopeId, scopes: ScopeResolutionIndexes, index: WorkspaceResolutionIndex, options?: ResolveCompoundReceiverOptions): SymbolDefinition | undefined;
/** A resolved compound receiver, together with the declared spelling that typed
 *  the position it came from — see {@link resolveCompoundReceiverTyped}. */
export interface TypedCompoundReceiver {
    readonly def: SymbolDefinition;
    /**
     * The receiver's declared type AS WRITTEN (`IValidator<string>`), or
     * `undefined` where the route that answered had no declared type to report — a
     * construction expression, a namespace target, a static class receiver. The
     * fan-out reads its generic arguments off this and restores the unfiltered
     * behaviour when it is absent, so declining is always safe (#2912).
     */
    readonly declaredSpelling: string | undefined;
}
/**
 * {@link resolveCompoundReceiverClass}, paired with the spelling that typed the
 * position (#2912).
 *
 * The sink is created and read HERE, per call, which is the whole point: a
 * recorder that outlives one resolution has to be reset by hand before every
 * call, and the retry shapes in this pass make two calls in a row — a reset
 * missed at one of them silently attributes the previous receiver's spelling to
 * this one. A local cannot be forgotten.
 *
 * The def-id guard is the second half. Lookups that lost — an MRO walk that
 * moved on, a fold step later folded past — report too, so a report counts only
 * when it names the class actually returned. `foldReceiverChain` reports its
 * final state last for exactly this reason, so the structural route wins.
 */
export declare function resolveCompoundReceiverTyped(receiverText: string, inScope: ScopeId, scopes: ScopeResolutionIndexes, index: WorkspaceResolutionIndex, options?: ResolveCompoundReceiverOptions): TypedCompoundReceiver | undefined;
export declare function resolveCompoundReceiverClass(receiverText: string, inScope: ScopeId, scopes: ScopeResolutionIndexes, index: WorkspaceResolutionIndex, options?: ResolveCompoundReceiverOptions, depth?: number): SymbolDefinition | undefined;
/**
 * Peel C-style cast layers off a receiver-position expression:
 * `((Target)((Other)expr))` → `workingText` `expr`, `castType`
 * `Target`. Pure text scan — no scope or index access — consumed by
 * `resolveCompoundReceiverClass` when a language opts in via
 * `stripReceiverCastExpressions`. Track the outermost meaningful cast
 * type: the cast narrows the receiver's declared type, so the caller
 * resolves the CAST type, not the underlying expression's type.
 *
 * Each peeled paren group with a non-empty trailing expression (a
 * cast candidate) is classified three ways:
 *   (a) simple identifier (`SIMPLE_CAST_TYPE_RE`) → cast type
 *       captured (outermost capture wins; later simple groups are
 *       noise casts, as in decompiler output like
 *       `((Target)((Object)expr))`);
 *   (b) type-shaped but unparseable here — dotted / generic / array
 *       (`UNPARSEABLE_CAST_TYPE_RE`) → this IS a cast, but its type
 *       cannot be looked up: report `unresolvableCast: true` so the
 *       caller resolves nothing rather than falling through to the
 *       pre-cast expression's own declared type (the pre-#2353 safe
 *       no-op for these shapes);
 *   (c) anything else → not a cast: stop scanning and return the
 *       text peeled so far for the normal resolver.
 * A paren group with an EMPTY remainder is never a cast candidate —
 * `((…))` / `(foo)` is a redundant-paren unwrap: unwrap and re-scan
 * without capturing anything.
 *
 * Known limitation: the paren scan is not string-literal-aware — a
 * `)` inside a quoted call argument (e.g. `((T)f(")")).g`) mis-scans
 * the group boundary. Such shapes classify as not-a-cast and fall
 * through safely to the normal resolver.
 */
export declare function stripCastWrappers(text: string): {
    workingText: string;
    castType: string | undefined;
    unresolvableCast: boolean;
};
export {};
