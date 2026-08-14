/**
 * Python binding for the language-agnostic constant resolver (#2391).
 *
 * Supplies the two Python-specific pieces the shared fold in
 * `constant-resolver.ts` needs — {@link resolvePythonImport} (import-specifier →
 * file, honoring leading-dot relative imports and `.py` module files) and
 * {@link extractPythonModuleConstants} (tree → {@link ModuleConstants}) — plus
 * pre-bound {@link resolveConstant}/{@link resolveOperands} wrappers so Python
 * callers stay language-oblivious. The reusable fold, the cycle guard, and the
 * depth cap all live in the agnostic core; a JVM/other language binding reuses
 * that core with its own `ImportResolver` + extractor.
 *
 * Keying (KTD4): the repo map is keyed by unique POSIX file path, NOT the
 * dot-stripped module basename. `from .constants import X`,
 * `from ..pkg.constants import X`, and `from constants import X` all collapse to
 * the basename `constants` — a ubiquitous filename — so basename keying would
 * resolve one package's routes to another's literal (a confidently WRONG path,
 * worse than an unresolved one). A relative import is therefore resolved against
 * the importing file's package directory (walk up one level per leading dot); an
 * absolute import is matched by unique path suffix and returns `null` (skip
 * floor) when ambiguous.
 */
import { type SyntaxNode } from '../utils/ast-helpers.js';
import type Parser from 'tree-sitter';
import { type ImportResolver, type ModuleConstants, type Operand, type RepoConstants } from './constant-resolver.js';
export type { ImportBinding, ModuleConstants, Operand, RepoConstants, } from './constant-resolver.js';
/**
 * The Python {@link ImportResolver}: map an import specifier to the unique file
 * key it refers to, or `null` when it cannot be pinned to exactly one file (KTD4).
 *
 * Relative imports (`.constants`, `..pkg.mod`) resolve against the importing
 * file's directory — one level up per leading dot beyond the first — and must
 * hit an existing file key exactly. Absolute imports (`api.constants`) are
 * matched by unique path suffix; a suffix shared by 2+ files is ambiguous and
 * returns `null` rather than an arbitrary winner.
 */
export declare const resolvePythonImport: ImportResolver;
/**
 * Resolve a single named Python constant referenced in `fileKey` to its literal
 * value, or `null`. Python-bound wrapper over the agnostic fold.
 */
export declare function resolveConstant(fileKey: string, name: string, repo: RepoConstants): string | null;
/**
 * Resolve an inline Python operand list (an unnamed `+`-expression at a decorator
 * argument, e.g. `@router.get(API_V1 + "/widgets")`) against `fileKey`.
 * Python-bound wrapper over the agnostic fold.
 */
export declare function resolveOperands(fileKey: string, operands: readonly Operand[], repo: RepoConstants): string | null;
/**
 * Parse a Python right-hand side into an operand list, or `null` when it is not a
 * foldable string expression. Handles a bare string literal, a bare identifier
 * (`X = Y`), and left-associative `+` chains of the two (`A + "/b" + C`).
 * Everything else — numbers, calls, attribute access (`settings.X`), f-strings,
 * conditional expressions (`x if c else y`), `concatenated_string` adjacency, and
 * non-`+` operators — returns `null`, which makes the constant unresolvable
 * (→ skip floor), never a wrong value.
 */
export declare function parseConstOperands(node: SyntaxNode | null | undefined, depth?: number): Operand[] | null;
/**
 * Extract the module-level string constants and `from … import …` bindings of
 * one parsed Python file into the {@link ModuleConstants} shape the resolver
 * consumes. Only top-level (`module`-direct) statements are walked — function-
 * and class-local names never become route path constants and must not leak in.
 *
 * Assignment semantics are last-wins in source order (matches Python): a rebind
 * to a non-string (`X = "/a"; X = build()`) drops `X` to unresolvable rather than
 * keeping the stale literal; `X += "/b"` folds onto the prior representation.
 *
 * Assignment RHS references are SNAPSHOTTED at the assignment line (`snapshot`),
 * not resolved lazily against a name's final binding — so `ROUTE = BASE; BASE +=
 * "/v1"` leaves `ROUTE` at BASE's value AT the `ROUTE =` line, never the mutated
 * one. Without this, an aliased-then-rebound constant resolved to a confidently
 * wrong path (#2393).
 */
export declare function extractPythonModuleConstants(tree: Parser.Tree): ModuleConstants;
