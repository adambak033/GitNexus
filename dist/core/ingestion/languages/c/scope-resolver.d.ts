import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
/**
 * C `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3).
 *
 * C is a structurally simple language for scope resolution:
 * - No classes (structs are value types, no method dispatch)
 * - No inheritance (no MRO needed beyond the shared first-wins default)
 * - No overloading (arity check is simple: variadic detection only)
 * - `#include` is wildcard import (all symbols from header are visible)
 * - `static` functions are file-local (not exported)
 */
export declare const cScopeResolver: ScopeResolver;
