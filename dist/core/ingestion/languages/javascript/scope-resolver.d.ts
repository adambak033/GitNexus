/**
 * JavaScript `ScopeResolver` registered in `SCOPE_RESOLVERS` and
 * consumed by the generic `runScopeResolution` orchestrator
 * (RFC #909 Ring 3, issue #928).
 *
 * Follows the same minimal wiring-only pattern as TypeScript (the third
 * migration). Per-hook logic lives in sibling modules:
 *
 *   - `query.ts`          — JS scope query + parser/query singletons
 *   - `captures.ts`       — `emitJsScopeCaptures` (JS grammar, CJS, JSDoc)
 *   - `interpret.ts`      — `interpretJsImport` (delegates to TS interpreter)
 *   - `simple-hooks.ts`   — `jsBindingScopeFor`, `jsImportOwningScope`,
 *                           `jsReceiverBinding` (all delegate to TS hooks)
 *   - `merge-bindings.ts` — `jsMergeBindings` (delegates to TS function)
 *   - `arity.ts`          — `jsArityCompatibility` (delegates to TS function)
 *   - `import-target.ts`  — `makeJsResolveImportTarget` (TS resolver, JS extensions)
 *
 * See `./index.ts` for the full per-module rationale.
 *
 * ## Key differences from TypeScript resolver
 *
 *   - `fieldFallbackOnMethodLookup: true` — JavaScript is dynamically typed;
 *     the field-fallback heuristic is ENABLED (unlike TypeScript, which
 *     disables it because the type-binding layer is precise).
 *   - `allowGlobalFreeCallFallback: true` — CJS `require` patterns and
 *     global helpers (e.g. `process`, `console`) benefit from workspace-
 *     wide unique-name fallback. TypeScript uses explicit imports.
 *   - `loadResolutionConfig` is omitted — JavaScript projects don't use
 *     `tsconfig.json` path aliases in general. `tsconfigPaths: null` is
 *     threaded through the resolver adapter.
 *   - `hoistTypeBindingsToModule: true` — JSDoc `@returns {T}` bindings are
 *     synthesized on the function scope and hoisted, matching TypeScript's
 *     method return-type hoisting strategy for cross-file chain resolution.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const javascriptScopeResolver: ScopeResolver;
export { javascriptScopeResolver };
