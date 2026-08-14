/**
 * Java `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3).
 *
 * Java resolves via the scope-resolution registry — the sole
 * call-resolution path.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const javaScopeResolver: ScopeResolver;
export { javaScopeResolver };
