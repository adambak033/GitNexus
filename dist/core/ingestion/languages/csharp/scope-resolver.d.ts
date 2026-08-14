/**
 * C# `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3).
 *
 * Second migration after Python — see `pythonScopeResolver` for the
 * canonical shape.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const csharpScopeResolver: ScopeResolver;
export { csharpScopeResolver };
