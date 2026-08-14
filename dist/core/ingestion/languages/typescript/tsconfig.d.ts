/**
 * Real `tsconfig.json` loading for module resolution (#2953).
 *
 * The previous loader (`language-config.ts:loadTsconfigPaths`) was built to feed
 * a heuristic, and it shows: it reads three filenames at the repo ROOT only,
 * gives up unless `compilerOptions.paths` exists, keeps only `targets[0]` of
 * each mapping, and treats a pattern as a plain prefix. That is enough to make
 * a guess look plausible and not enough to resolve anything correctly:
 *
 *   - a monorepo has one tsconfig PER PACKAGE, and `apps/web/tsconfig.json` is
 *     what governs `apps/web/src/main.ts` — the root config governs nothing;
 *   - `extends` is how essentially every real config is written, and the
 *     `baseUrl` / `paths` almost always live in the extended base;
 *   - `baseUrl` alone (no `paths`) is a complete resolution rule on its own, and
 *     it is exactly the rule that makes `import 'src/utils/foo'` legal — the
 *     case the old suffix matcher was really standing in for;
 *   - `paths` maps a pattern to an ORDERED LIST of targets, tried in order.
 *
 * So this module answers the question TypeScript actually asks: for THIS file,
 * what are `baseUrl` and `paths`?
 */
/** One `paths` entry, pattern and targets kept in declaration order. */
export interface TsPathMapping {
    /** The pattern as written, e.g. `@/*`, `@app/*`, `exact`. */
    readonly pattern: string;
    /** Targets as written, relative to `baseUrl`. Tried in order. */
    readonly targets: readonly string[];
}
/** The resolution-relevant part of one resolved tsconfig. */
export interface TsconfigScope {
    /** Repo-relative directory the config governs (the tsconfig's own directory). */
    readonly dir: string;
    /**
     * Repo-relative `baseUrl`, or `null` when the config declares none.
     *
     * `null` is not the same as `'.'`: without `baseUrl`, TypeScript does NOT
     * resolve non-relative specifiers against the project at all (they are
     * package lookups), and `paths` targets are resolved against the tsconfig's
     * own directory instead.
     */
    readonly baseUrl: string | null;
    readonly paths: readonly TsPathMapping[];
}
/** Every tsconfig in the repo, indexed so the nearest one to a file wins. */
export interface TsconfigIndex {
    /** Deepest-first, so the first `dir` that prefixes a file path governs it. */
    readonly scopes: readonly TsconfigScope[];
}
/**
 * The config governing `filePath` — the nearest tsconfig at or above it.
 *
 * TypeScript resolves a file against the project that includes it; the nearest
 * enclosing tsconfig is the faithful approximation of that without evaluating
 * `include`/`exclude` globs, and it is what makes a monorepo's per-package
 * `baseUrl` apply to that package's files instead of the root's.
 */
export declare function tsconfigFor(index: TsconfigIndex | null, filePath: string): TsconfigScope | null;
/** Load every tsconfig in the repo, resolving `extends` chains. */
export declare function loadTsconfigIndex(repoRoot: string): Promise<TsconfigIndex | null>;
