/**
 * C# arity check, accommodating `params` variadic and default parameters.
 *
 * The `def` metadata we care about (synthesized by `arity-metadata.ts`):
 *   - `parameterCount`         — total formal parameters; `undefined`
 *                                when the method has `params T[]` variadic.
 *   - `requiredParameterCount` — min required (excludes defaulted params
 *                                and `params` variadic).
 *   - `parameterTypes`         — declared type strings; contains the
 *                                literal `'params'` when the method is
 *                                variadic.
 *
 * Verdicts:
 *   - `'compatible'`   — `requiredParameterCount <= argCount <= parameterCount`,
 *                        OR the def takes `params` (then any `argCount >= required`).
 *   - `'incompatible'` — argCount is below required, OR above max with no variadic.
 *   - `'unknown'`      — metadata is absent / incomplete.
 *
 * `'incompatible'` is a soft signal in `Registry.lookup` (penalized but
 * still considered when no compatible candidate exists), per RFC §4.
 */
import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
export declare function csharpArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
