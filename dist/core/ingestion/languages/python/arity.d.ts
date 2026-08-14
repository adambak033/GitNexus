/**
 * Python arity check, accommodating `*args`, `**kwargs`, and defaults.
 *
 * The `def` metadata we care about (set by the existing Python method/
 * function extractor):
 *   - `parameterCount`         — total positional + keyword params
 *   - `requiredParameterCount` — min required (excludes defaults / `*args` / `**kwargs`)
 *   - `parameterTypes`         — present when types are known; we also use it
 *                                as a "we have varargs" hint (`'*args'`,
 *                                `'**kwargs'` literals appear in the array).
 *
 * Verdicts:
 *   - `'compatible'`   — `requiredParameterCount <= argCount <= parameterCount`,
 *                        OR the def takes `*args` (then any `argCount >= required` ok).
 *   - `'incompatible'` — argCount is below required, OR above max with no `*args`.
 *   - `'unknown'`      — def metadata is absent / incomplete.
 *
 * `'incompatible'` is a soft signal in `Registry.lookup` (penalized but
 * still considered when no compatible candidate exists), per RFC §4.
 */
import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
export declare function pythonArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
