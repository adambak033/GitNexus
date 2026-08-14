/**
 * Overload narrowing — pick candidates from a list of same-named
 * method / function overloads using the call-site's arity and
 * argument-type signals.
 *
 * Used by both `receiver-bound-calls.ts::pickOverload` (explicit
 * receiver member call) and `free-call-fallback.ts::pickImplicitThisOverload`
 * (implicit `this` free-call inside a class-like body). Shared to keep
 * narrowing semantics in lockstep across the two sites.
 *
 * Semantics (first-wins; callers take `result[0]`):
 *   1. If `argCount` is undefined, arity is a pass-through.
 *   2. Exact-required-match wins over variadic. Variadic is detected
 *      via a `parameterTypes` entry equal to `'params'` or starting
 *      with `'params '` (C# `params` / variadic marker).
 *   3. If the arity filter empties the set AND any candidate had
 *      unknown bounds (both `parameterCount` and `requiredParameterCount`
 *      undefined), fall back to the full overload list — the empty
 *      result may be due to missing metadata rather than a real mismatch.
 *      If EVERY rejected candidate had definite arity bounds, trust the
 *      filter and return empty — the call is genuinely arity-incompatible
 *      (e.g., PHP `f(int $req, ...$rest)` called with zero args).
 *   4. If `argTypes` is present, filter further by per-slot type
 *      equality. An empty string in `argTypes[i]` means "unknown" and
 *      counts as a match. Mismatches disqualify. A non-empty typed
 *      result wins; otherwise return the arity-filtered candidates.
 *   4b. When the exact-type filter from step 4 returns empty AND a
 *       `conversionRankFn` is provided (via `hookCtx`), rank candidates
 *       via pairwise dominance comparison (ISO C++ [over.ics.rank]):
 *       F1 beats F2 only when F1 is not worse for every arg and better
 *       for at least one. Non-dominated candidates are returned;
 *       multiple survivors are genuinely ambiguous.
 *   4c. Final per-candidate constraint filter (SFINAE / `requires`).
 *       When `constraintCompatibility` is provided via `hookCtx`, drop
 *       candidates whose template constraints provably fail at the
 *       call site. Three-valued; `'unknown'` keeps the candidate
 *       (monotonicity).
 *   4d. Conservative C++ template partial-order approximation. When
 *       template-placeholder overloads remain tied, prefer a candidate
 *       whose parameter shape is more specialized for the observed
 *       argument shape (`T*` over `T`, `const T&` over `T`). Unknown or
 *       incomparable shapes are left ambiguous.
 *   5. Empty input returns empty output.
 */
import type { ArityVerdict, Callsite, ConstraintContext, ParameterTypeClass, SymbolDefinition } from '../../../../_shared/index.js';
/**
 * Per-slot conversion-rank function. Returns a numeric cost for
 * converting `argType` to `paramType`:
 *   - 0 = exact match (no conversion)
 *   - 1 = promotion (e.g. char→int, bool→int in C++)
 *   - 2 = standard conversion (e.g. int→double)
 *   - Infinity = incompatible types
 *
 * Each language provides its own implementation. The function operates
 * on normalized type strings (output of the language's type normalizer).
 */
export type ConversionRankFn = (argType: string, paramType: string, argTypeClass?: ParameterTypeClass, paramTypeClass?: ParameterTypeClass) => number;
/**
 * Optional hook bundle for narrowing extension points. Threaded in
 * from `pickOverload` / `pickImplicitThisOverload` so per-language
 * narrowing can layer in conversion-rank scoring (#1606) and
 * constraint filtering (#1579) without changing the call signature
 * at every site. Each hook is independently optional — leaving both
 * undefined preserves the legacy arity + exact-type behavior.
 */
export interface OverloadNarrowingHookCtx {
    /** Shape-preserving per-argument sidecar aligned with `argTypes`. */
    readonly argumentTypeClasses?: ConstraintContext['argumentTypeClasses'];
    /** Conversion-rank scoring fallback (step 4b). Engages when the
     *  exact-type filter rejects every candidate. */
    readonly conversionRankFn?: ConversionRankFn;
    /** Per-language argument-type prefixes whose conversion-rank failures
     *  should suppress genuinely ambiguous multi-overload sets instead of
     *  falling back to arity-only candidates. */
    readonly conversionOnlyArgTypePrefixes?: readonly string[];
    /** Constraint filter (step 4c). Drops candidates whose template
     *  guards (SFINAE `enable_if_t`, C++20 `requires`, future Rust
     *  trait bounds, etc.) provably fail at the call site. Three-valued
     *  — `'unknown'` keeps the candidate (monotonicity). */
    readonly constraintCompatibility?: (callsite: Callsite, def: SymbolDefinition, ctx: ConstraintContext) => ArityVerdict;
}
export declare function narrowOverloadCandidates(overloads: readonly SymbolDefinition[], argCount: number | undefined, argTypes: readonly string[] | undefined, hookCtx?: OverloadNarrowingHookCtx): readonly SymbolDefinition[];
/**
 * Detect when >1 candidate share identical `parameterTypes` after the
 * per-language normalizer has collapsed distinct underlying types. This
 * signals "the resolver cannot pick the right overload — the
 * normalization that helps single-candidate flows now hides a real
 * ambiguity" and lets callers suppress the edge rather than pick
 * arbitrarily.
 *
 * Concrete trigger (PR #1520 review follow-up plan U2, Claude review
 * Finding 5): the C++ `arity-metadata.ts` normalizer collapses `int`,
 * `long`, `short`, `unsigned`, and `size_t` to `'int'`. Without this
 * check, `process(int)` and `process(long)` both end up with
 * `parameterTypes === ['int']`, and `pickOverload` arbitrarily picks
 * the first — emitting a false CALLS edge to the wrong overload.
 *
 * Returns false when:
 *   - 0 or 1 candidates (no ambiguity to detect)
 *   - any candidate has undefined `parameterTypes` (can't compare)
 *   - candidates differ in arity or in any parameter-type slot
 *
 * Other languages: this check is a precondition gate, not a behavior
 * change for normal narrowing. Languages whose normalizers do not
 * collapse distinct types (verified by grep over `*-arity-metadata.ts`
 * — no `int → int` collapse outside C++) will never produce >1
 * candidate with identical `parameterTypes` from genuinely distinct
 * declarations, so this returns false for them. The branch is
 * effectively C++-only in practice.
 */
export declare function isOverloadAmbiguousAfterNormalization(candidates: readonly SymbolDefinition[], argCount?: number): boolean;
