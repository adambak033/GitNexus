/**
 * Import-aware taint-site matcher (#2083 M3 U2, plan KTD7).
 *
 * Classifies a function's harvested {@link SiteRecord}s against a registered
 * {@link SourceSinkSanitizerSpec}: which member reads are SOURCES, which
 * call/new sites are SINKS (and at which argument positions), and which are
 * SANITIZERS. Pure main-thread data work — sites + bindings come from the U1
 * worker harvest, imports from `ParsedFile.parsedImports`; no AST, no I/O.
 *
 * PRECONDITION: the caller must gate the CFG through `hasTaintSafeSites`
 * (taint/site-safety.ts) first — this module dereferences binding/site
 * indices without re-validating them.
 *
 * ## Callee resolution precedence (bare and member-rooted calls)
 *
 * 1. ESM import join — the callee root's local name is resolved through the
 *    {@link TaintImportIndex} built from `parsedImports` (`named`/`alias`
 *    members, `namespace`/default-import module handles); `import { exec as
 *    run } from 'child_process'` makes `run(c)` resolve to
 *    `child_process.exec`, and `import * as cp …` makes `cp.exec(c)` resolve
 *    the same way.
 * 2. require-literal join — a binding whose in-function defining site carries
 *    `requireArg` resolves like a namespace handle (`const cp =
 *    require('child_process'); cp.exec(c)`). A BARE call of a require-joined
 *    binding is matched under BOTH interpretations, `<module>.default` (the
 *    module/default export invoked directly) and `<module>.<localName>`
 *    (non-renamed destructured require — the harvest attaches `resultDefs`
 *    to destructured bindings without recording the property path, and the
 *    binding name IS the member name in the non-renamed case).
 * 3. Bare-name fallback — TRUE GLOBALS only (`global: true` entries: `eval`,
 *    `new Function`, `encodeURIComponent`), and only when the name is neither
 *    import-bound nor shadowed. Conventional receiver names (`req`/`request`
 *    member-read sources, `res.send`, `.query`/`.execute`) are matched
 *    name-based by their own mechanisms, never via the global fallback.
 *
 * ## Shadowing rule (exact)
 *
 * A name is treated as function-local — blocking import/global resolution —
 * iff the function's binding table contains a NON-`synthetic` entry with that
 * name (an in-function `function exec(){}` / `const exec = …`). Synthetic
 * bindings (kind `module`, `synthetic: true`) are imports, true globals, or
 * enclosing-scope captures and do not shadow. Member-call roots use the
 * harvested `receiver` binding index directly (no name scan).
 *
 * ## Documented resolution gaps (direction stated, per plan KTD10)
 *
 * - MODULE-LEVEL `const cp = require('child_process')`: the binding is
 *   synthetic inside the function, produces no `ParsedImport`, and its
 *   defining site lives outside the function's harvested sites — the
 *   require join cannot see it. Module-mechanism sinks miss (FN) and
 *   sanitizers don't kill (FP noise — never a false kill, the safe
 *   direction). Only in-function requires resolve.
 * - RENAMED destructured require (`const { exec: run } = require(…)`):
 *   the dual interpretation resolves `run` to `child_process.run` — no
 *   match (FN). Non-renamed destructures resolve exactly.
 * - CONSERVATIVE shadow scan for bare calls: ANY non-synthetic binding of
 *   the callee name anywhere in the function blocks import/global
 *   resolution, even when the shadow is block-scoped elsewhere and the call
 *   site actually sees the import (FN; rare; safe for sanitizers).
 * - MODULE-LEVEL user declarations are indistinguishable from imports in
 *   the binding table (both synthetic). ESM forbids a module-level
 *   declaration colliding with an import name, so the import join is
 *   authoritative when an import exists; a module-level user function
 *   shadowing a TRUE GLOBAL (e.g. a local `encodeURIComponent`) is not
 *   detectable and would still match (pathological; accepted).
 * - Handle COPIES (`const c2 = cp; c2.exec(…)`) are not followed — joins
 *   are one level deep (binding → import/require), never through
 *   assignments (FN).
 * - `this.`/`super.`-rooted and call-rooted callee chains have no
 *   resolvable root: only the syntactic `anyReceiver`/`receivers`
 *   mechanisms can match them.
 * - `reexport`/`wildcard`/`dynamic-*`/`side-effect` imports introduce no
 *   matcher-visible local binding and are skipped by the index.
 */
import type { ParsedImport } from '../../../_shared/index.js';
import type { FunctionCfg } from '../cfg/types.js';
import type { TaintCallResultSourceEntry, SourceSinkSanitizerSpec, TaintMemberSourceEntry, TaintSanitizerEntry, TaintSinkEntry } from './source-sink-config.js';
/** What a local name imported into the file denotes. */
export interface TaintImportBinding {
    /** Normalized module specifier (`node:` scheme stripped). */
    readonly module: string;
    /**
     * Exported member bound by a named/aliased import; `undefined` when the
     * local name is a MODULE HANDLE (namespace import, or a default import —
     * CJS interop makes the default export ≈ the module object).
     */
    readonly member?: string;
    /**
     * True when the provider says `module` already includes `member`; used for
     * class-like imports where a receiver call should resolve as
     * `<module>.<method>`, not `<module>.<member>.<method>`.
     */
    readonly targetIncludesMember?: boolean;
}
/** Local name → import provenance for one file. Build once per file (U4). */
export type TaintImportIndex = ReadonlyMap<string, TaintImportBinding>;
/** A member-read site matched as a taint source. */
export interface MatchedSourceRead {
    readonly type: 'member-read';
    /** Index into the owning statement's `sites` array. */
    readonly siteIndex: number;
    readonly entry: TaintMemberSourceEntry;
}
/** A call-result source matched on a call site with direct result definitions. */
export interface MatchedSourceCall {
    readonly type: 'call-result';
    /** Index into the owning statement's `sites` array. */
    readonly siteIndex: number;
    readonly entry: TaintCallResultSourceEntry;
    /** Bindings directly defined by this call result. Never empty. */
    readonly resultDefs: readonly number[];
}
export type MatchedSource = MatchedSourceRead | MatchedSourceCall;
/** A call/new site matched as a sink. */
export interface MatchedSinkCall {
    /** Index into the owning statement's `sites` array. */
    readonly siteIndex: number;
    readonly entry: TaintSinkEntry;
    /**
     * Positions (indices into `site.args`) that are registered sink positions
     * AND carry at least one recorded binding occurrence, after the spread
     * rule (a recorded position ≥ `site.spread` matches when any registered
     * position ≥ the spread index exists — runtime positions after a spread
     * are unknowable) and the template rule (`template: true` aggregates all
     * substitutions at position 0 and matches any-position). Never empty — a
     * sink whose dangerous positions carry no occurrences cannot produce a
     * finding and is not reported.
     */
    readonly argPositions: readonly number[];
}
/** A call site matched as a sanitizer (import-aware/global only — see module doc). */
export interface MatchedSanitizerCall {
    /** Index into the owning statement's `sites` array. */
    readonly siteIndex: number;
    readonly entry: TaintSanitizerEntry;
    /**
     * Bindings the sanitizer's result defines directly (`const b = escape(t)`
     * ⇒ `b`) — U3's kill targets (KTD4b). Empty for value-position sanitizer
     * calls (`exec(escape(x))`), whose effect is occurrence INTERPOSITION via
     * the site's `parent`/via-tag chain, not a def kill.
     */
    readonly resultDefs: readonly number[];
}
/** All matches within one statement. Emitted only when at least one list is non-empty. */
export interface StatementMatches {
    readonly blockIndex: number;
    readonly statementIndex: number;
    readonly line: number;
    readonly sources: readonly MatchedSource[];
    readonly sinks: readonly MatchedSinkCall[];
    readonly sanitizers: readonly MatchedSanitizerCall[];
}
/** Classified sites for one function, in (block, statement, site, entry) order. */
export interface FunctionSiteMatches {
    readonly statements: readonly StatementMatches[];
    /** Fast-path gates for U4: the solver runs only when both are true. */
    readonly hasSource: boolean;
    readonly hasSink: boolean;
}
/**
 * Build the local-name → module/member index from a file's `parsedImports`.
 * Only `named`/`alias`/`namespace` kinds bind matcher-visible local names;
 * `importedName === 'default'` collapses to a module handle.
 */
export declare function buildTaintImportIndex(imports: readonly ParsedImport[]): TaintImportIndex;
/**
 * Classify a function's harvested sites against a language spec. See the
 * module doc for resolution precedence, the shadowing rule, and gaps.
 */
export declare function matchFunctionSites(cfg: FunctionCfg, spec: SourceSinkSanitizerSpec, imports: TaintImportIndex): FunctionSiteMatches;
