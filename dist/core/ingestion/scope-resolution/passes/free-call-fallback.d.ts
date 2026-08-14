/**
 * Emit CALLS edges for free-call reference sites whose target is
 * imported (or otherwise visible only via post-finalize scope.bindings).
 *
 * The shared `MethodRegistry.lookup` only consults `scope.bindings`
 * (pre-finalize / local-only) for free calls. Cross-file imports land
 * in `indexes.bindings` (post-finalize). Without this fallback, every
 * `from x import f; f()` resolves to "unresolved".
 *
 * **Free-call dedup contract (Contract Invariant I2):** free calls
 * collapse to one CALLS edge per (caller, target) pair regardless of
 * how many call sites the caller contains. Mirrors the legacy DAG's
 * dedup semantics (what the `default-params` / `variadic` / `overload`
 * fixtures expect). Member calls keep position-based dedup elsewhere.
 *
 * Generic; promoted from `languages/python/scope-resolver.ts` per the scope-resolution
 * generalization plan.
 */
import type { ParameterTypeClass, ParsedFile, Reference, ScopeId, SymbolDefinition } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { SemanticModel } from '../../model/semantic-model.js';
import type { WorkspaceResolutionIndex } from '../workspace-index.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { ScopeResolver } from '../contract/scope-resolver.js';
import type { ResolutionOutcomeRecorder } from '../resolution-outcome.js';
import type { CalleeIdSink } from '../graph-bridge/callee-id-sink.js';
import { type ConversionRankFn } from './overload-narrowing.js';
export declare function emitFreeCallFallback(graph: KnowledgeGraph, scopes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, _referenceIndex: {
    readonly bySourceScope: ReadonlyMap<ScopeId, readonly Reference[]>;
}, handledSites: Set<string>, model: SemanticModel, workspaceIndex: WorkspaceResolutionIndex, options?: {
    readonly allowGlobalFallback?: boolean;
    /** When true, `Type(...)` constructor calls link to the Class def
     *  itself rather than its explicit Constructor. Swift opts in. */
    readonly constructorCallTargetsClass?: boolean;
    readonly isFileLocalDef?: (def: SymbolDefinition) => boolean;
    readonly isCallableVisibleFromCaller?: (ctx: {
        readonly callerParsed: ParsedFile;
        readonly candidate: SymbolDefinition;
        readonly callerScope?: ScopeId;
        readonly scopes?: ScopeResolutionIndexes;
    }) => boolean;
    readonly resolveAdlCandidates?: (site: {
        readonly name: string;
        readonly arity?: number;
        readonly argumentTypes?: readonly string[];
        readonly atRange: {
            readonly startLine: number;
            readonly startCol: number;
        };
    }, callerParsed: ParsedFile, scopes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[]) => readonly SymbolDefinition[] | undefined;
    /** Module-qualified free-call resolver (#2730) — see
     *  `ScopeResolver.resolveQualifiedFreeCall`. */
    readonly resolveQualifiedFreeCall?: ScopeResolver['resolveQualifiedFreeCall'];
    readonly conversionRankFn?: ConversionRankFn;
    readonly conversionOnlyArgTypePrefixes?: readonly string[];
    /** Optional per-language constraint hook threaded into
     *  `narrowOverloadCandidates`. Drops candidates whose template
     *  constraints (e.g. C++ `enable_if_t`, C++20 `requires`) provably
     *  fail at the call site. Three-valued; `'unknown'` keeps the
     *  candidate (monotonicity). */
    readonly constraintCompatibility?: ScopeResolver['constraintCompatibility'];
    /** Platform/language built-in names (e.g. `fetch`, `setTimeout`) that
     *  are never real repository declarations. Gates the finalize-bucket
     *  guard below (#2545) -- see `hasGenuineLexicalBinding`. */
    readonly isBuiltInName?: (name: string) => boolean;
    /** Instance-ownership gate (#2550): a free call may resolve to a
     *  `Method` only when the caller's enclosing class chain (self + MRO)
     *  contains the method's owner. See
     *  `ScopeResolver.freeCallsRequireInstanceOwnership`. */
    readonly freeCallsRequireInstanceOwnership?: boolean;
    readonly recordResolutionOutcome?: ResolutionOutcomeRecorder;
    /** Call sites owned by a later precise pass (for example callable-value-flow). */
    readonly skipSites?: ReadonlySet<string>;
    /** Resolved-callee-id capture sink (#2227 U2). Threaded in under `--pdg`
     *  OR for callable-flow's direct-target index (#2437, position-filtered);
     *  `undefined` ⇒ zero overhead, byte-identity (R4). Captured at the CALLS
     *  emit below BEFORE the collapsed `seen` dedup (KTD6) so same-target
     *  multi-line calls are still recorded per site. */
    readonly calleeIdSink?: CalleeIdSink;
}): number;
/**
 * Build a `simpleName -> callable defs` index from `scopes.defs` once per
 * pass. Mirrors the filter the old per-site scan applied: Function /
 * Method / Constructor, keyed by the last `.`-segment of `qualifiedName`
 * (falling back to the qualifiedName itself when undotted). Used by
 * `pickUniqueGlobalCallable` so every free-call fallback site is O(1)
 * instead of O(|defs|).
 *
 * Exported for unit testing — language-agnostic logic, exercised via synthetic
 * stubs in `pick-unique-global-callable.test.ts`.
 */
export declare function buildGlobalCallableIndex(scopes: ScopeResolutionIndexes): ReadonlyMap<string, readonly SymbolDefinition[]>;
/**
 * Build a `simpleName -> class-like defs` index from `scopes.defs` once per
 * pass — the structural sibling of `buildGlobalCallableIndex`, consumed by
 * `pickUniqueGlobalClass` so constructor-form fallback is O(1)-per-site
 * instead of O(|defs|).
 *
 * **Kind filter (KTD5 — KEEP `'Interface'`):** the set is
 * `Class | Struct | Interface`, matching the idiomatic class-like set used
 * elsewhere in the scope-resolution bridge (`graph-bridge/ids.ts`,
 * `node-lookup.ts`). This is a behavior-PRESERVING perf refactor for all 8
 * `allowGlobalFreeCallFallback` languages — the previous per-site scan used
 * exactly this filter. Excluding Swift `protocol` (`Interface`) defs because
 * protocols aren't instantiable is a *separate* Swift-semantics question with
 * its own test; dropping `Interface` here would be a deliberate
 * behavior-changing edit, not part of U5.
 *
 * Bucket insertion order follows `defs.byId.values()` iteration order, so the
 * downstream "keep first" / ambiguity ordering in `pickUniqueGlobalClass` is
 * byte-identical to the old linear scan (equivalence verified).
 *
 * Exported for unit testing — language-agnostic logic, exercised via synthetic
 * stubs in `pick-unique-global-class.test.ts`.
 */
export declare function buildGlobalClassIndex(scopes: ScopeResolutionIndexes): ReadonlyMap<string, readonly SymbolDefinition[]>;
/**
 * Resolve a free (unqualified, receiver-less) call to a globally-unique
 * callable def by simple name. See the in-body comments for the narrowing
 * order. Exported for unit testing — the `scopeDefsCache` equivalence is
 * exercised via synthetic stubs in `pick-unique-global-callable.test.ts`.
 */
export declare function pickUniqueGlobalCallable(name: string, model: SemanticModel, globalCallablesBySimpleName: ReadonlyMap<string, readonly SymbolDefinition[]>, callerFilePath: string, isFileLocalDef?: (def: SymbolDefinition) => boolean, callArity?: number, isCallerVisible?: (candidate: SymbolDefinition) => boolean, callArgTypes?: readonly string[], callArgTypeClasses?: readonly ParameterTypeClass[], conversionRankFn?: ConversionRankFn, scopeDefsCache?: Map<string, readonly SymbolDefinition[]>, conversionOnlyArgTypePrefixes?: readonly string[]): SymbolDefinition | undefined;
/** Find a unique workspace-wide class-like def by simple name, for a
 *  constructor-form call `Type(...)` whose type lives outside the call
 *  site's lexical bindings (a sibling/imported file). Returns the def
 *  only when all matches share ONE qualified name — i.e. they are
 *  fragments of a single logical type (partial classes / extensions
 *  that re-key onto the same type), which resolve to the same graph
 *  node. Genuinely distinct types with the same simple name are
 *  ambiguous and leave the call unresolved rather than guessing. Gated
 *  by the caller on `allowGlobalFallback`, mirroring
 *  `pickUniqueGlobalCallable`.
 *
 *  Consumes the once-built `buildGlobalClassIndex` (`simpleName ->
 *  class-like defs`) so each call site is O(1) rather than O(|defs|).
 *  The index's `Class | Struct | Interface` kind filter is intentionally
 *  KEPT (KTD5) — see `buildGlobalClassIndex` for why dropping `Interface`
 *  would be a separate, behavior-changing Swift-semantics edit.
 *
 *  Exported for unit testing — language-agnostic logic, exercised via
 *  synthetic stubs in `pick-unique-global-class.test.ts`. The production
 *  call site is the constructor-form fallback in `emitFreeCallFallback`. */
export declare function pickUniqueGlobalClass(name: string, index: ReadonlyMap<string, readonly SymbolDefinition[]>): SymbolDefinition | undefined;
/** Walk up from the call-site scope to the enclosing class scope,
 *  pick a method member by name with overload narrowing on arity +
 *  argument types. Returns undefined if there's no enclosing class,
 *  no matching method, OR narrowing leaves multiple compatible
 *  candidates — in the multi-candidate case, picking
 *  `candidates[0]` would emit a high-confidence CALLS edge whose
 *  target depends on registration order rather than a defensible
 *  resolution. Mirrors `pickUniqueGlobalCallable`'s uniqueness check
 *  in the same file (Codex PR #1497 review, finding 2).
 *
 *  Exported for unit testing — language-agnostic logic, exercised
 *  via synthetic stubs in `pick-implicit-this-overload.test.ts`. The
 *  production call site is `applyFreeCallFallback` immediately above. */
export declare function pickImplicitThisOverload(site: {
    readonly inScope: ScopeId;
    readonly name: string;
    readonly arity?: number;
    readonly argumentTypes?: readonly string[];
    readonly argumentTypeClasses?: readonly import('../../../../_shared/index.js').ParameterTypeClass[];
}, scopes: ScopeResolutionIndexes, workspaceIndex: WorkspaceResolutionIndex, model: SemanticModel, hookCtx?: {
    readonly conversionRankFn?: ConversionRankFn;
    readonly conversionOnlyArgTypePrefixes?: readonly string[];
    readonly constraintCompatibility?: ScopeResolver['constraintCompatibility'];
}): SymbolDefinition | undefined;
