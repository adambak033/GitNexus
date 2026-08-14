/**
 * Dart `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by the
 * generic `runScopeResolution` orchestrator (RFC #909 Ring 3, issue #939).
 *
 * Closest reference: Swift (`swiftScopeResolver`) — both are statically typed,
 * have no `new` keyword, and model `Type(...)` as a reference to the type.
 *
 * ## Dart specifics
 *
 *   - **`implements` / `with`.** Dart can implement (and mixes in) ordinary
 *     classes, so the edge type cannot be decided from the target's symbol
 *     kind (the generic `preEmitInheritanceEdges` pre-pass routes
 *     `Interface`/`Trait` → IMPLEMENTS, everything else → EXTENDS). `extends`
 *     is captured as `@reference.inherits` and rides the generic pre-pass
 *     (target is a class → EXTENDS); `implements`/`with` are carried as
 *     `__heritage__:` side-effect imports and emitted here as IMPLEMENTS by
 *     `emitDartHeritageEdges`. METHOD_IMPLEMENTS then falls out of the shared
 *     MRO/interface-dispatch phase.
 *   - **Mixin MRO.** `buildDartMro` augments the EXTENDS chain with mixin /
 *     interface ancestors (IMPLEMENTS edges) so mixed-in members participate
 *     in method lookup (PHP/Ruby trait pattern).
 *   - **No `new`.** `Type(...)` resolves to the Class node
 *     (`constructorCallTargetsClass`); the cross-file global free-call
 *     fallback is allowed (`allowGlobalFreeCallFallback`).
 *   - **Statically typed** → `fieldFallbackOnMethodLookup: false` (the
 *     field-walk heuristic over-connects when types are reliable).
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
export declare const dartScopeResolver: ScopeResolver;
