import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
/**
 * C++ `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3).
 *
 * C++ extends C's scope resolution with:
 *   - Namespaces (`namespace foo { ... }`)
 *   - Classes with methods and multiple inheritance
 *   - `using namespace` (wildcard import from namespace)
 *   - `using X::name` (named import from namespace)
 *   - Anonymous namespace (file-local linkage, like C `static`)
 *   - Default parameters (requiredParameterCount < parameterCount)
 *   - Overloading (arity-based disambiguation)
 *   - Templates (V1: generic-ignored, `List<User>` ≡ `List`)
 *   - Leftmost-base MRO for multiple inheritance
 */
export declare const cppScopeResolver: ScopeResolver;
