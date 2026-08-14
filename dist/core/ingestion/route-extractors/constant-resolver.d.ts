/**
 * Language-agnostic string-constant folding for route-path resolution (#2391).
 *
 * Route decorators/annotations frequently build their path from a constant rather
 * than a string literal — `@router.post(API_V1_WIDGETS_GET)` (Python),
 * `@GetMapping(PathConstants.WIDGETS)` (Spring), and the Kotlin/C# equivalents are
 * the same shape. This module folds such a constant — or an inline
 * `+`-concatenation — to its literal value, following `+` operands and import
 * chains across a repo-wide, file-keyed constant map.
 *
 * The FOLD is language-neutral: it walks {@link Operand} lists and
 * {@link ModuleConstants} that ANY language's extractor can produce, and defers
 * the one language-specific decision — mapping an import specifier to the file it
 * refers to — to a caller-supplied {@link ImportResolver}. A language binding
 * (e.g. `python-const-resolver.ts`) provides that resolver plus a tree →
 * {@link ModuleConstants} extractor and, if wanted, thin pre-bound wrappers.
 *
 * This mirrors how `route-path.ts` (URL normalization) and `spring-shared.ts`
 * (annotation primitives) are shared across the ingestion and group layers and
 * across languages: the reusable core lives in one place; per-language semantics
 * plug in. It deliberately does NOT reuse `ScopeResolver` (which resolves symbol
 * IDENTITIES, not literal string VALUES) or the `--pdg` `REACHING_DEF` layer
 * (intra-procedural, function-local, def→use reachability — not module-level
 * cross-file value folding).
 */
/**
 * One term of a constant's right-hand side. A `+`-concatenation
 * (`A + "/b" + C`) becomes an ordered `Operand[]`; a bare literal is a
 * single-element list.
 */
export type Operand = {
    readonly kind: 'literal';
    readonly value: string;
} | {
    readonly kind: 'ref';
    readonly name: string;
};
/**
 * A `from <module> import <name> [as <local>]` (or the language's equivalent)
 * binding. `module` is the import specifier as written (e.g. `.constants`,
 * `..pkg.constants`, `api.constants`) so the {@link ImportResolver} can apply
 * language-specific rules; `originalName` is the exported name in the target
 * module (pre-alias). The map key is the local (in-file) name.
 */
export interface ImportBinding {
    readonly module: string;
    readonly originalName: string;
}
/**
 * String-valued module-level constants of one source file. `literals` are
 * fully-resolved (`X = "/a"`); `exprs` are unresolved operand lists
 * (`X = A + "/b"`); `imports` maps a local name to the module it was imported
 * from. All string keys are the in-file (local) names.
 */
export interface ModuleConstants {
    readonly literals: Map<string, string>;
    readonly exprs: Map<string, readonly Operand[]>;
    readonly imports: Map<string, ImportBinding>;
}
/** Repo-wide map: unique file key (e.g. `app/constants.py`) → that file's
 * {@link ModuleConstants}. */
export type RepoConstants = ReadonlyMap<string, ModuleConstants>;
/**
 * Resolve an import specifier (as written) from `importingFileKey` to the unique
 * repo file key it refers to, or `null` when it cannot be pinned to exactly one
 * file. This is the sole language-specific dependency of the fold: Python uses
 * leading-dot relative imports + `.py`-suffix rules; a JVM binding would use
 * package/classpath rules. Returning `null` on ambiguity keeps the fold honest —
 * an unresolvable or ambiguous import floors to skip, never a wrong path.
 */
export type ImportResolver = (importingFileKey: string, moduleSpec: string, repoKeys: ReadonlySet<string>) => string | null;
/**
 * Resolve a single named constant referenced in `fileKey` to its literal string
 * value, folding `+` concatenation and following import chains via
 * `resolveImport`, or `null` when it cannot be fully folded.
 */
export declare function resolveConstant(fileKey: string, name: string, repo: RepoConstants, resolveImport: ImportResolver): string | null;
/**
 * Resolve an inline operand list (an unnamed `+`-expression captured directly at
 * a decorator/annotation argument, e.g. `@router.get(API_V1 + "/widgets")`)
 * against `fileKey`.
 */
export declare function resolveOperands(fileKey: string, operands: readonly Operand[], repo: RepoConstants, resolveImport: ImportResolver): string | null;
