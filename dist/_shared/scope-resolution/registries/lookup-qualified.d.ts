/**
 * `lookupQualified` — qualified-name fast path (RFC §4.5; Ring 2 SHARED #917).
 *
 * Consults `QualifiedNameIndex` directly, filters by `acceptedKinds`, and
 * returns `Resolution[]` with `origin: 'global-qualified'` evidence. Used by:
 *
 *   - `resolveTypeRef` dotted fallback (#916)
 *   - `Registry.lookup` Step 6 when no lexical candidate survived
 *   - Explicit dotted identifiers in Cypher / MCP tools where the caller
 *     knows the target's canonical qualified name
 *
 * **Strict + deterministic.** No receiver-type resolution, no scope walk.
 * Every surviving candidate gets the same base confidence (from
 * `EvidenceWeights.globalQualified`), then the tie-break cascade
 * disambiguates.
 */
import type { NodeLabel } from '../../graph/types.js';
import type { Resolution } from '../types.js';
import type { RegistryContext } from './context.js';
export interface LookupQualifiedParams {
    readonly acceptedKinds: readonly NodeLabel[];
}
/**
 * Look up a canonical qualified name (e.g., `app.models.User`) across all
 * defs, filtered by `acceptedKinds`. Returns an empty array when the name
 * is not indexed or no candidate matches the kind filter.
 *
 * Callers consume `[0]` for the strict single-return answer; the remainder
 * carries alternate candidates (partial classes, overloads, accidental
 * cross-kind hits) ordered by the tie-break cascade.
 */
export declare function lookupQualified(qualifiedName: string, params: LookupQualifiedParams, ctx: RegistryContext): readonly Resolution[];
//# sourceMappingURL=lookup-qualified.d.ts.map