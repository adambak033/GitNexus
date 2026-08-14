/**
 * `resolveTypeRef` — strict single-return resolver for `TypeRef`s
 * (RFC §4.6; Ring 2 SHARED #916).
 *
 * Narrower contract than `Registry.lookup`: no name-only global fallback, no
 * confidence ranking, no arity check. Used by `Registry.lookup` Step 2 (type-
 * binding propagation) and by any caller that wants the single best type-
 * target for an annotation without paying for the full evidence pipeline.
 *
 * **Algorithm (strict).** Walk the scope chain from `ref.declaredAtScope`:
 *
 *   1. At each scope, inspect `bindings.get(ref.rawName)`:
 *      - If one of the bindings is a **type-kind** def with a **strict origin**
 *        (`'local' | 'import' | 'namespace' | 'reexport'`), return it.
 *      - If any binding for this name exists at this scope but none qualifies
 *        (e.g., a local variable named `User` shadows an outer import of class
 *        `User`), return `null`. The nearer binding shadows; we do NOT fall
 *        through to the global qualified-name index.
 *      - Otherwise continue to the parent scope.
 *   2. If the raw name is a dotted path (e.g., `'models.User'`) and the scope
 *      walk produced no match, consult `QualifiedNameIndex.byQualifiedName`.
 *      Only accept **exactly one** type-kind hit — anything ambiguous returns
 *      `null` rather than a guess.
 *   3. Return `null`.
 *
 * **What `'strict' origins' means.** `'wildcard'` is intentionally excluded.
 * A wildcard-expanded name (`from x import *`) is too loose to use as an
 * anchor for type resolution — it gives no signal about whether the name was
 * actually imported. `Registry.lookup` may accept wildcard bindings at its
 * own discretion (with lower evidence weight); `resolveTypeRef` does not.
 *
 * **What 'type-kind' means.** The subset of `NodeLabel` that a type annotation
 * may legitimately reference: class-like, interface-like, enum-like, and
 * alias-like kinds. See `TYPE_KINDS` below.
 *
 * Pure function — safe to call repeatedly; no side effects.
 */
import type { SymbolDefinition } from './symbol-definition.js';
import type { ScopeLookup, TypeRef } from './types.js';
import type { DefIndex } from './def-index.js';
import type { QualifiedNameIndex } from './qualified-name-index.js';
/**
 * All inputs `resolveTypeRef` needs from the semantic model. Bundled into a
 * context object so the call site stays short and the interface is stable as
 * additional indexes get threaded through in later rings.
 */
export interface ResolveTypeRefContext {
    readonly scopes: ScopeLookup;
    readonly defIndex: DefIndex;
    readonly qualifiedNameIndex: QualifiedNameIndex;
}
export declare function resolveTypeRef(ref: TypeRef, ctx: ResolveTypeRefContext): SymbolDefinition | null;
//# sourceMappingURL=resolve-type-ref.d.ts.map