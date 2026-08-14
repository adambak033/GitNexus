/**
 * `lookupCore` — the shared 7-step canonical resolution algorithm
 * (RFC §4.2; Ring 2 SHARED #917).
 *
 * Pure function. Given a name, a starting scope, and per-kind parameters,
 * walks lexical scopes + optional type-binding MRO + optional owner
 * contributor + global qualified-name fallback, and returns a ranked
 * `Resolution[]` with per-candidate evidence.
 *
 * All three public registries (`ClassRegistry` / `MethodRegistry` /
 * `FieldRegistry`) dispatch into this function, differing only in the
 * parameters they pass. The CHOICE of which steps fire is expressed
 * through `LookupParams`, not through different algorithms per kind.
 *
 * ## Algorithm (RFC §4.2, verbatim names)
 *
 * **Step 1 — Lexical scope-chain walk.** From `startScope`, walk
 *   parent-ward. At each scope, consult `scope.bindings.get(name)`:
 *     - Filter candidates whose `def.type ∈ acceptedKinds`.
 *     - For each surviving candidate, record a raw signal with the
 *       binding's origin + the current scope-chain depth.
 *     - **Hard shadow.** If `bindings.get(name)` is non-empty (including
 *       non-kind-matching candidates), stop walking. The name is
 *       lexically bound here; outer scopes are not consulted.
 *
 * **Step 2 — Type-binding resolution.** When `useReceiverTypeBinding`
 *   is true, resolve the receiver's type at `startScope` (from
 *   `scope.typeBindings`), then walk the MRO via
 *   `MethodDispatchIndex.mroFor(ownerDefId)`. Membership per owner comes
 *   through an optional `RegistryContext.ownedMembersByOwner` hook when
 *   supplied (`undefined` → fall back to `defs.byId`; `[]` → indexed
 *   miss), otherwise via the compatibility fallback scan over
 *   `defs.byId`; each hit records a raw signal with the owner's
 *   MRO depth.
 *
 * **Step 3 — Owner-scoped contributor.** When
 *   `params.ownerScopedContributor` is present, merge its `byName(name)`
 *   hits with `origin: 'local'` (they are declared directly on the
 *   receiver). Distinct from Step 2 — Step 2 walks the MRO; Step 3 only
 *   looks at the directly-declared owner members.
 *
 * **Step 4 — Kind filter (emit `kind-match` evidence).** Already
 *   applied during Steps 1-3; this step just adds a `kind-match` signal
 *   at weight 0 to every candidate for debuggability (so the evidence
 *   array is self-describing).
 *
 * **Step 5 — Arity filter.** Call `providers.arityCompatibility(callsite,
 *   def)` per surviving candidate. Verdicts: `compatible` / `unknown` /
 *   `incompatible`. If at least one candidate is `compatible`, drop
 *   `incompatible` ones. Otherwise keep all (the penalty weight alone
 *   will rank them lower but they remain in the result).
 *
 * **Step 6 — Global fallback.** When Steps 1-3 produced **no**
 *   candidates and the name contains a `.`, consult the
 *   `QualifiedNameIndex` via `lookupQualified` — see §4.5. The `scope`
 *   argument is NOT passed here because global lookup is scope-agnostic.
 *
 * **Step 7 — Rank + tie-break.** Compose evidence, compute confidence
 *   (sum capped at 1.0), sort by the RFC Appendix B cascade.
 *
 * ## What this module does NOT do
 *
 *   - No AST reads (pure data in, pure data out).
 *   - No `gitnexus/` imports.
 *   - No language switches. Language-specific behavior flows exclusively
 *     through `providers.*` and the `params` object.
 *   - No caching. Callers that want memoization can wrap this function.
 */
import type { Callsite, LookupParams, Resolution, ScopeId } from '../types.js';
import type { OwnerScopedContributor, RegistryContext } from './context.js';
/** Extended `LookupParams` narrowing `ownerScopedContributor` to the concrete shape. */
export interface CoreLookupParams extends Omit<LookupParams, 'ownerScopedContributor'> {
    readonly ownerScopedContributor: OwnerScopedContributor | null;
    /** Call-site description forwarded to `arityCompatibility`. Optional — for non-call lookups. */
    readonly callsite?: Callsite;
}
/**
 * Run the 7-step lookup. Returns a non-empty `Resolution[]` when any
 * candidate was found; an empty array otherwise. Callers consume `[0]`
 * for the best answer and optionally inspect the rest for alternates.
 */
export declare function lookupCore(name: string, startScope: ScopeId, params: CoreLookupParams, ctx: RegistryContext): readonly Resolution[];
//# sourceMappingURL=lookup-core.d.ts.map