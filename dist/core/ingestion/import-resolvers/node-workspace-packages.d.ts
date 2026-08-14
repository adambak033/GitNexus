/**
 * In-repo `package.json` manifests, as module-resolution input (#2953).
 *
 * A bare specifier (`@acme/telemetry/nest`, `@repo/utils`, `lodash/fp`) names a
 * PACKAGE, not a path, and the manifest is the only thing that says which
 * packages exist and where their entry points are. Without it a resolver can do
 * nothing but guess — which is what the old suffix matcher did, landing
 * `@acme/telemetry/nest` on the repo's only path ending in `nest/index.ts`
 * while `@repo/utils`, a real first-party package, resolved to nothing because
 * its name appears in no file path at all.
 *
 * Both directions come from the same missing input, so both are fixed by
 * reading it: every in-repo `package.json` contributes its `name`, its `exports`
 * map (including subpath patterns), its legacy entry fields, and its `imports`
 * map for `#`-prefixed specifiers.
 */
/** One in-repo package. */
export interface NodeWorkspacePackage {
    /** Repo-relative directory holding the `package.json` (`''` for the root). */
    readonly dir: string;
    /**
     * Repo-relative entry stems for the package root (`import '@repo/utils'`),
     * best first: declared `exports["."]`, then `module` / `main` / `types`, then
     * the conventional `src/index` and `index`.
     *
     * A published `dist/...` entry simply fails to match an indexed source file
     * (build output is not indexed) and the next candidate is tried, which is why
     * the conventional fallbacks stay at the end rather than being a guess: they
     * are what the package resolves to when it is consumed from source, which in
     * a workspace it always is.
     */
    readonly entries: readonly string[];
    /**
     * Declared `exports` subpaths, specifier suffix -> repo-relative stems.
     * Keys are as written minus the leading `./`, so `"./nest"` is stored `nest`;
     * a pattern key keeps its `*` (`"./features/*"` -> `features/*`).
     */
    readonly subpathExports: ReadonlyMap<string, readonly string[]>;
    /** Declared `imports` map, `#name` -> repo-relative stems. */
    readonly subpathImports: ReadonlyMap<string, readonly string[]>;
}
export interface NodeWorkspacePackages {
    /** Package name (`@repo/utils`, `utils`) -> that package. */
    readonly byName: ReadonlyMap<string, NodeWorkspacePackage>;
}
/**
 * The package name a bare specifier addresses, or `null` when the specifier
 * names a path rather than a package.
 *
 * `@acme/telemetry/nest` -> `@acme/telemetry`, `lodash/fp` -> `lodash`.
 */
export declare function nodePackageNameOf(specifier: string): string | null;
/** The in-repo package whose directory most closely contains `filePath`. */
export declare function owningPackage(filePath: string, packages: NodeWorkspacePackages | null | undefined): NodeWorkspacePackage | null;
/**
 * Resolve a bare specifier that names an in-repo package.
 *
 * `null` means the specifier names no in-repo package — an external dependency,
 * whose correct in-repo resolution is nothing — or names one that does not
 * export the requested subpath.
 */
export declare function resolveNodeWorkspaceImport(specifier: string, packages: NodeWorkspacePackages | null | undefined, allFiles: ReadonlySet<string>): string | null;
/**
 * Look a specifier up in a subpath map — `exports` or `imports`, which share
 * Node's matching rule exactly: an exact key wins, otherwise the pattern with
 * the longest literal prefix does, and its `*` takes whatever the specifier put
 * there.
 *
 * Shared because they diverged once: the `imports` side did an exact lookup
 * only, so a declared `"#internal/*"` could never match `#internal/foo`.
 */
export declare function matchSubpathMap(map: ReadonlyMap<string, readonly string[]>, specifier: string): readonly string[] | null;
/**
 * Substitute a subpath pattern's single `*`.
 *
 * Node's subpath patterns and TypeScript's `paths` both allow AT MOST one `*`,
 * so replacing the first occurrence is the specified behaviour rather than a
 * partial one — but `String.replace` with a string needle says that only by
 * accident, and reads as a bug to anyone (CodeQL included) who has met the
 * replace-all footgun. Slicing at the known index states the rule instead.
 */
export declare function substituteStar(target: string, stem: string): string;
/**
 * Collect the `package.json` of every ADMITTED workspace package.
 *
 * Directory-only BFS: the sole files opened are manifests and the workspace
 * declaration, so this is far cheaper than the C# namespace scan next door,
 * which reads every `.cs` file.
 */
export declare function loadNodeWorkspacePackages(repoRoot: string): Promise<NodeWorkspacePackages | null>;
