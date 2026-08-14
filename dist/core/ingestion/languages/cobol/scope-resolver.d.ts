/**
 * COBOL `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed
 * by the generic `runScopeResolution` orchestrator.
 *
 * The provider is a thin wiring object — COBOL's simple scope model
 * (Module + Function only, no inheritance, no type system) plugs into
 * `runScopeResolution` with minimal configuration.
 *
 * Reference: `languages/python/scope-resolver.ts`.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const cobolScopeResolver: ScopeResolver;
export { cobolScopeResolver };
