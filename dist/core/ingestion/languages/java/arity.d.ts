/**
 * Java arity check, accommodating varargs (`...`).
 *
 * Verdicts:
 *   - `'compatible'`   — argCount matches parameterCount, OR varargs present.
 *   - `'incompatible'` — argCount mismatches with no varargs.
 *   - `'unknown'`      — metadata absent / incomplete.
 */
import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
export declare function javaArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
