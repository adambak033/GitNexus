import type { Callsite, SymbolDefinition } from '../../../../_shared/index.js';
export declare function rustArityCompatibility(def: SymbolDefinition, callsite: Callsite): 'compatible' | 'unknown' | 'incompatible';
