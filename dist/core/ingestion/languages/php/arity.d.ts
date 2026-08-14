/**
 * PHP arity check, accommodating variadic (`...$args`) and default parameters.
 *
 * The `def` metadata synthesized by `arity-metadata.ts`:
 *   - `parameterCount`         — total formal parameters; `undefined` when
 *                                the method has a variadic `...$param`.
 *   - `requiredParameterCount` — min required (excludes defaulted params
 *                                and the variadic itself).
 *   - `parameterTypes`         — declared type strings; contains the
 *                                literal `'...'` when the method is variadic.
 *
 * Verdicts:
 *   - `'compatible'`   — `required <= argCount <= max`, OR the def has
 *                        variadic (any `argCount >= required`).
 *   - `'incompatible'` — argCount below required, or above max with no variadic.
 *   - `'unknown'`      — metadata absent / incomplete; named-args can satisfy
 *                        any arity so we return unknown when we detect them.
 *
 * PHP supports named arguments (PHP 8.0+): `save(force: true)`. Named-arg
 * call sites cannot be arity-checked statically without parsing arg names,
 * so we return `'unknown'` when the callsite carries named args (signalled
 * by a negative `arity` value per the shared Callsite contract).
 */
import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
export declare function phpArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
