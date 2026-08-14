import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
/**
 * C++ arity compatibility: supports overloading and default parameters.
 *
 * Unlike C (no overloading, exact match only), C++ has:
 *   - Overloaded functions (same name, different signatures)
 *   - Default parameters (requiredParameterCount < parameterCount)
 *   - Variadic functions (C-style `...`)
 *   - Parameter packs (V1: treated as variadic)
 *   - Templates: arity check on non-template params; SFINAE / `requires`
 *     constraints are filtered separately via `constraintCompatibility`
 *     (see `constraint-filter.ts` and issue #1579). Type-argument generic
 *     substitution (`List<T>` ≡ `List<U>`) remains out of V1 scope.
 *
 * Verdict:
 *   - 'compatible':    callsite.arity fits within [required, total] range
 *   - 'incompatible':  callsite.arity is outside the valid range
 *   - 'unknown':       insufficient metadata to determine
 */
export declare function cppArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
