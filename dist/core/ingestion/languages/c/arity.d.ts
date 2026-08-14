import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
/**
 * C arity compatibility: no overloading. Variadic functions detected
 * via '...' in parameterTypes. Otherwise exact match or unknown.
 */
export declare function cArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
