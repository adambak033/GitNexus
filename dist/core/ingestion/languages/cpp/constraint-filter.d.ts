/**
 * Kleene 3-valued evaluator + curated 4-predicate registry +
 * `cppConstraintCompatibility` hook export for SFINAE / `requires`-clause
 * filtering (issue #1579).
 *
 * Semantics:
 *   - `'incompatible'` → predicate provably fails for these argumentTypes
 *     (ISO `[temp.constr.atomic]` "not satisfied")
 *   - `'compatible'`   → predicate provably holds
 *   - `'unknown'`      → cannot decide (missing arg-type info, predicate
 *     not in registry, AST shape bailed during extraction). The shared
 *     filter keeps the candidate on `'unknown'` — monotonicity guarantee.
 *
 * Kleene rules (extension of ISO's 2-valued short-circuit conjunction in
 * `<https://en.cppreference.com/w/cpp/language/constraints>`):
 *   AND: incompatible if any child incompatible; compatible iff all
 *        children compatible; otherwise unknown.
 *   OR:  compatible if any child compatible; incompatible iff all
 *        children incompatible; otherwise unknown.
 *   NOT: flip compatible↔incompatible; pass through unknown.
 */
import type { ArityVerdict, Callsite, ConstraintContext, SymbolDefinition } from '../../../../_shared/index.js';
import type { ConstraintExpr, CppConstraintPayload } from './constraint-extractor.js';
/** Public surface — registered as `ScopeResolver.constraintCompatibility`. */
export declare function cppConstraintCompatibility(_callsite: Callsite, def: SymbolDefinition, ctx: ConstraintContext): ArityVerdict;
/** Exposed for unit tests — lets `cpp-constraint.test.ts` assert
 *  `expect(getRegistrySize()).toBe(4)` without exporting the Map itself. */
export declare function getRegistrySize(): number;
/** Exposed for unit tests covering the Kleene 3-valued truth table
 *  directly, without an AST round-trip. */
export declare function evaluateForTest(expr: ConstraintExpr, payload: CppConstraintPayload, ctx: ConstraintContext): ArityVerdict;
