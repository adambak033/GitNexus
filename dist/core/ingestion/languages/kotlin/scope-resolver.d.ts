import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
/**
 * Kotlin scope resolver for RFC #909 Ring 3.
 *
 * Kotlin resolves via the scope-resolution registry — production
 * resolution flows through the scope-resolution pipeline as the sole
 * call-resolution path.
 *
 * **Coverage:** 208/208 fixtures pass after the migration sub-issues
 * #1758–#1763, the
 * companion/instance dispatch fix #1756, and the lambda scopes
 * fix #1757. Covers core import, receiver, companion, default-param,
 * vararg, constructor, local assignment-chain, collection-iteration,
 * smart casts (`when (x) { is T -> … }` and `if (x is T)` — #1758),
 * cross-file iterable return propagation (#1759), single-level
 * method-chain fixpoint receiver types (#1760), parameter-type-narrowed
 * overload target-id selection (#1761), virtual dispatch via constructor
 * RHS (`val x: Animal = Dog()` — #1762), interface default-method
 * dispatch via implements-split MRO (#1763), companion-object vs
 * instance member dispatch (#1756) via the `isStaticOnly` hook
 * (including named companions and MRO-shadow / chain-typebinding /
 * value-receiver crossover cases), and lambda-body Block scopes
 * with scoped type-bindings for explicit parameters and implicit
 * `it` (#1757) via `synthesizeKotlinLambdaBindings` plus the
 * `(lambda_literal) @scope.block` query rule.
 *
 * **Legacy parity skip list:** `LEGACY_RESOLVER_PARITY_EXPECTED_FAILURES.kotlin`
 * in `test/integration/resolvers/helpers.ts` records scope-resolver-only
 * correctness wins that the legacy DAG cannot replicate. As of #1756 /
 * #1757 there are 8 entries covering: the bare companion-vs-instance
 * crossover, three MRO-shadow / standalone-chain cases, the chained-
 * forEach lambda-scope case, the named-companion crossover, and the
 * Case-0 / Case-3b / Case-5 companion crossovers under
 * `kotlin-companion-other-cases`. Each entry is documented inline with
 * its issue ref and rationale.
 */
export declare const kotlinScopeResolver: ScopeResolver;
