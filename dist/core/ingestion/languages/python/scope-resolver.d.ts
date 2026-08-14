/**
 * Python `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed
 * by the generic `runScopeResolution` orchestrator.
 *
 * The provider is a thin wiring object — Python's specific bits
 * (super recognizer, LEGB merge precedence, Python's relative-import
 * resolver, the simplified MRO walk) plug into `runScopeResolution`.
 *
 * Migration reference: when bringing up the next language
 * (TypeScript / Java / Kotlin / Ruby), copy this file's structure —
 * implement the 6 required `ScopeResolver` fields, optionally toggle
 * the 2 booleans, and register in `scope-resolution/pipeline/registry.ts`.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const pythonScopeResolver: ScopeResolver;
export { pythonScopeResolver };
