/**
 * `ScopeExtractor` — the central, source-agnostic driver that turns a
 * language provider's `CaptureMatch[]` into a `ParsedFile`
 * (RFC §5.3 + §3.2 Phase 1; Ring 2 PKG #919).
 *
 * Exactly one entry point: `extract(matches, filePath, provider) → ParsedFile`.
 * Runs a five-pass pipeline over the matches. Each pass is internal; the
 * public contract is the output `ParsedFile`.
 *
 * ## Design principles
 *
 *   - **Source-agnostic.** Consumes `CaptureMatch[]` from providers;
 *     doesn't know whether they came from tree-sitter queries or COBOL's
 *     regex tagger. No `Tree` / `SyntaxNode` types leak into this file.
 *   - **One AST walk per language.** Providers do the AST walk inside
 *     their `emitScopeCaptures` hook; this driver does zero further
 *     traversal — it consumes captures only.
 *   - **Pure-ish.** The extractor itself is pure (same matches →
 *     same ParsedFile) when providers are pure. No side effects, no I/O.
 *   - **Centralized invariant enforcement.** Structural invariants on the
 *     scope tree (non-module has parent; parent contains child; siblings
 *     don't overlap) are enforced by `buildScopeTree` from Ring 2 SHARED
 *     (#912). Malformed inputs throw `ScopeTreeInvariantError`.
 *
 * ## The five passes
 *
 *   1. **Build scope tree.** Walk `@scope.*` matches. For each, consult
 *      `provider.resolveScopeKind` (default: suffix of the capture name).
 *      Derive parent by lexical-range containment. Hand the resulting
 *      `Scope[]` to `buildScopeTree` for validation.
 *   2. **Attach declarations + local bindings.** Walk `@declaration.*`
 *      matches. For each, build a `SymbolDefinition` and attach it to
 *      `provider.bindingScopeFor` (default: innermost containing scope)
 *      as `ownedDefs` + a local `BindingRef { origin: 'local' }`.
 *   3. **Collect raw imports.** Walk `@import.*` matches. Call
 *      `provider.interpretImport` per match; attach the returned
 *      `ParsedImport` to the ParsedFile — not to any `Scope`.
 *      `provider.importOwningScope` is declared on `LanguageProvider` and
 *      implemented by a dozen providers, but has no call site anywhere; this
 *      step's output is a flat per-file list.
 *
 *      One scope fact is read before that list flattens it away:
 *      `runsOnlyWhenCalled`, set when the statement sits anywhere inside a
 *      `Function`. It is decided here because here is the last stage that can
 *      — finalize receives the flat list, and its consumer receives a map
 *      keyed by the file's Module scope only (see
 *      `ParsedImport.runsOnlyWhenCalled`). This is a position fact, not a
 *      syntax one, so it is decided centrally for every language rather than
 *      per provider — with one capability a provider may declare to opt out
 *      of it entirely, `importsExecuteWhereWritten: false`, because position
 *      cannot defer an import that never executes (C/C++ `#include`, Rust
 *      `use`, COBOL `COPY`). Providers still decide their own *syntactic* nesting
 *      facts in their capture emitters, where the node is in hand (see
 *      `languages/python/import-decomposer.ts`).
 *   4. **Collect type bindings.** Walk `@type-binding.*` matches. Call
 *      `provider.interpretTypeBinding` per match. Attach the resulting
 *      `TypeRef` to the innermost containing scope's `typeBindings`
 *      (or override via `provider.bindingScopeFor` if set).
 *   5. **Collect reference sites.** Walk `@reference.*` matches. Emit
 *      one `ReferenceSite` per match. Classify call form via
 *      `provider.classifyCallForm` (default: the capture's sub-tag if
 *      present; else `'free'`).
 *
 * ## What gets attached where
 *
 *   - `Scope.bindings`     — **local bindings only** at this stage (Pass 2).
 *                            Finalize (#915) merges imports/wildcards on top.
 *   - `Scope.ownedDefs`    — declarations structurally owned by this scope.
 *   - `Scope.typeBindings` — local type facts (parameter annotations, `self`).
 *   - `Scope.imports`      — empty here. Populated by the finalize algorithm
 *                            when it resolves `ParsedImport.targetRaw`.
 *   - `ParsedFile.parsedImports` — every raw import in this file.
 *   - `ParsedFile.localDefs`     — flattened union of `Scope.ownedDefs`.
 *   - `ParsedFile.referenceSites` — pre-resolution usage facts.
 */
import type { CaptureMatch, ParsedFile, SymbolDefinition } from '../../_shared/index.js';
import type { LanguageProvider } from './language-provider.js';
/**
 * The subset of `LanguageProvider` members that `extract()` reads — the hooks
 * it calls plus the capability flags it consults. Declared as its own type so:
 *
 *   - Tests can implement just these members without faking the whole
 *     `LanguageProvider` interface (which is ~40 fields including the
 *     legacy-DAG surface).
 *   - The extractor's dependency contract stays explicit — adding a new
 *     hook read requires updating this type.
 *
 * Real callers pass a full `LanguageProvider` — structural typing makes it
 * a `ScopeExtractorHooks` for free.
 */
export type ScopeExtractorHooks = Pick<LanguageProvider, 'resolveScopeKind' | 'scopeOwnsReceivers' | 'bindingScopeFor' | 'interpretImport' | 'importsExecuteWhereWritten' | 'interpretTypeBinding' | 'classifyCallForm'>;
/**
 * Drive the five extraction passes and return a `ParsedFile`.
 *
 * Throws `ScopeTreeInvariantError` (from #912) when the provider emits
 * captures that violate structural scope invariants (e.g., overlapping
 * sibling scopes). When no `@scope.module` capture is present, a
 * synthetic Module scope is created spanning all captures, and orphan
 * non-Module scopes are re-parented under it. This enables indexing of
 * files where tree-sitter produces an ERROR root (e.g., complex .phtml
 * templates with mixed PHP/HTML/JS).
 */
export declare function extract(matches: readonly CaptureMatch[], filePath: string, provider: ScopeExtractorHooks): ParsedFile;
/**
 * Collapse rule for the deferred node-creation migration (#1876).
 *
 * When graph-node creation moves from the legacy DAG onto the
 * registry-primary path, a single source binding can carry more than one
 * `SymbolDefinition` for the same name in the same scope — e.g. a direct
 * arrow `const fn = () => {}` is classified BOTH as a `Function` (the
 * arrow) and a `Variable` (the binding). Emitting one graph node per def
 * would reproduce exactly the duplicate-node bug this issue tracks.
 *
 * `selectNodeBearingDef` picks the ONE def that should bear the graph node
 * for such a binding group:
 *
 *   1. a function-like def (`Function` / `Method` / `Constructor`) if any —
 *      the binding is callable and must keep incoming `CALLS` edges;
 *   2. otherwise a value def (`Const` / `Variable`) — the binding holds a
 *      value (e.g. an array-method result after the U1/U2 narrowing);
 *   3. otherwise the first def — deterministic fallback for label sets this
 *      rule does not rank.
 *
 * INPUT CONTRACT: `group` must be the defs bound to ONE name within ONE
 * scope (a binding group). It deliberately does NOT dedup by range —
 * `SymbolDefinition` carries no range and `makeDefId` encodes only the
 * start position, so containment is uncomputable here; the caller forms the
 * group (e.g. from a scope's `ownedDefs` keyed by name) before calling.
 *
 * Pure. No production call site yet — this dead export is intentional and
 * tracked by #1876 (the deferred node-creation migration); it is the
 * executable contract that follow-up will consume, pinned today by the
 * scope-extractor unit test.
 */
export declare function selectNodeBearingDef(group: readonly SymbolDefinition[]): SymbolDefinition | undefined;
