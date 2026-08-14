/**
 * Decompose a TypeScript `import_statement` / re-export `export_statement` /
 * dynamic `call_expression(import)` into one `CaptureMatch` per imported
 * name.
 *
 * Why split here? The `LanguageProvider.interpretImport` contract is
 * one `ParsedImport` per call. Tree-sitter delivers
 *
 *   import D, { X as Y, type Z } from './m'
 *
 * as a single `import_statement` match, so without decomposition we'd
 * lose names. The synthesized markers (`@import.kind` / `@import.name`
 * / `@import.alias` / `@import.source`) carry everything
 * `interpretTsImport` needs to recover the `ParsedImport` shape —
 * see `interpret.ts`.
 *
 * Kinds we emit and how `interpret.ts` maps them to `ParsedImport`:
 *
 *   - `default`            : `import D from './m'`          → alias (importedName=default)
 *   - `named`              : `import { X } from './m'`      → named
 *   - `named-alias`        : `import { X as Y } from './m'` → alias
 *   - `namespace`          : `import * as N from './m'`     → namespace
 *   - `reexport`           : `export { X } from './m'`      → reexport
 *   - `reexport-alias`     : `export { X as Y } from './m'` → reexport (with alias)
 *   - `reexport-wildcard`  : `export * from './m'`          → wildcard
 *   - `reexport-namespace` : `export * as ns from './m'`    → namespace (local=ns,imported=source)
 *   - `dynamic`            : `import('./m')` / `import(x)`  → dynamic-resolved or dynamic-unresolved
 *
 * Type-only constructs (`import type { X }`, `import { type X }`,
 * `export type { X }`) emit the same kinds as runtime forms — at the
 * TypeScript scope-resolution layer, types and values share the same
 * lookup, so the KIND is unchanged. They additionally carry an
 * `@import.type-only` marker, because `tsc` deletes them: no `require` /
 * `import` for the source module survives in the emitted JavaScript, so
 * the pair cannot force a module-initialization order. `check --cycles`
 * is the consumer — see `graph-bridge/imports-to-edges.ts`.
 *
 * Both spellings put the `type` keyword in a different place, so both are
 * read (see `hasTypeKeyword`):
 *
 *   import type { X, Y } from './m'   — anonymous `type` token on the
 *                                       `import_statement`, covering EVERY
 *                                       specifier it decomposes to
 *   import { type X, Y } from './m'   — anonymous `type` token on the
 *                                       `import_specifier`, covering only X
 *
 * The marker is therefore per-specifier, which is what makes the mixed
 * statement come out right: `X` is erased, `Y` is not, and the pair
 * `./m` is a real initialization dependency because of `Y`. Emission
 * dedupes per `(sourceFile, targetFile)` and lets any non-erased edge win,
 * so a statement counts as type-only exactly when every specifier it
 * decomposes to is — without this file having to aggregate anything.
 *
 * Known gap: TypeScript 5.0's `export type * from './m'` / `export type *
 * as ns from './m'`. The vendored grammar does not parse them — the bare
 * `type` token lands in an `ERROR` node beside the `*`, not as a statement
 * child — so they emit no marker and are treated as value imports. That is
 * the fail-safe direction (`check --cycles` over-reports rather than
 * hiding a real cycle), and neither form appears in this repository.
 *
 * Side-effect imports (`import './polyfill'`) produce a single match
 * with `kind: 'side-effect'`. The shared finalize algorithm resolves
 * the target file and emits a file-level IMPORTS edge, but
 * materializes no `BindingRef` (matching the legacy DAG, which counts
 * `import './polyfill'` as a module-reachability dependency only).
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Decompose an import anchor. Handles three node types:
 *
 *   - `import_statement`             : all static import forms (incl. side-effect)
 *   - `export_statement` (w/ source) : re-exports
 *   - `call_expression` (import fn)  : dynamic `import()`
 */
export declare function splitImportStatement(stmtNode: SyntaxNode): CaptureMatch[];
