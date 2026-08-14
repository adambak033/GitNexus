/**
 * TypeScript `ScopeResolver` registered in `SCOPE_RESOLVERS` and
 * consumed by the generic `runScopeResolution` orchestrator
 * (RFC #909 Ring 3).
 *
 * Third migration after Python and C#. Follows the same minimal
 * wiring-only pattern — per-hook logic lives in the sibling modules
 * (`arity.ts`, `merge-bindings.ts`, `import-target.ts`, etc.).
 *
 * See ./index.ts for the per-module rationale and the full list of
 * known limitations. The canonical capture vocabulary is pinned in
 * ./query.ts (TYPESCRIPT_SCOPE_QUERY constant).
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const typescriptScopeResolver: ScopeResolver;
export { typescriptScopeResolver };
