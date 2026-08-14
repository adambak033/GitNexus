/**
 * Per-language `ScopeResolver` registry — the lookup the generic
 * `scopeResolutionPhase` uses to pick the right resolver for each
 * migrated language.
 *
 * Adding a language is two lines: implement a `ScopeResolver` in
 * `languages/<lang>/scope-resolver.ts` and register it here. The
 * phase picks it up automatically — no workflow changes, no
 * per-language pipeline phase file.
 */
import { SupportedLanguages } from '../../../../_shared/index.js';
import type { ScopeResolver } from '../contract/scope-resolver.js';
/** Map of `SupportedLanguages` → `ScopeResolver`. The scope-resolution phase
 *  iterates this map directly — every registered resolver runs. This is the
 *  single source of truth for which languages resolve via scope-resolution. */
export declare const SCOPE_RESOLVERS: ReadonlyMap<SupportedLanguages, ScopeResolver>;
