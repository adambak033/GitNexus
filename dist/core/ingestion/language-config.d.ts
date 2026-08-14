/** TypeScript path alias config parsed from tsconfig.json */
export interface TsconfigPaths {
    /** Map of alias prefix -> target prefix (e.g., "@/" -> "src/") */
    aliases: Map<string, string>;
    /** Base URL for path resolution (relative to repo root) */
    baseUrl: string;
}
/** Go module config parsed from go.mod */
export interface GoModuleConfig {
    /** Module path (e.g., "github.com/user/repo") */
    modulePath: string;
}
/** PHP Composer PSR-4 autoload config */
export interface ComposerConfig {
    /** Map of namespace prefix -> directory (e.g., "App\\" -> "app/") */
    psr4: Map<string, string>;
    /** PSR-4 entries sorted by namespace length descending (longest match wins).
     *  Cached once at config load time to avoid re-sorting on every import. */
    psr4Sorted?: readonly [string, string][];
}
/** C# project config parsed from .csproj files */
export interface CSharpProjectConfig {
    /** Root namespace from <RootNamespace> or assembly name (default: project directory name) */
    rootNamespace: string;
    /** Directory containing the .csproj file */
    projectDir: string;
}
/**
 * Declared-namespace evidence used to gate C# suffix-fallback resolution so
 * BCL usings (e.g. `System.Threading.Tasks`) can't match a coincidentally-
 * named local file (#1881).
 */
export interface CSharpNamespaceEvidence {
    /** Every `namespace X.Y` declared in-repo (scan may be capped — see `truncated`). */
    readonly declaredNamespaces?: ReadonlySet<string>;
    /** csproj RootNamespace values plus the top-level segment of each declared
     *  namespace — the anchor set for the parent-namespace gate direction. */
    readonly rootNamespaces?: ReadonlySet<string>;
    /** True when the BFS hit its dir/depth cap, so the namespace set may be
     *  incomplete; the gate fails open (allows) in that case. */
    readonly truncated?: boolean;
}
/** Result of a single BFS over a repo collecting both csproj configs and
 *  declared `.cs` namespaces (one disk traversal — see `scanCSharpProject`). */
export interface CSharpProjectScan {
    readonly configs: CSharpProjectConfig[];
    readonly declaredNamespaces: ReadonlySet<string>;
    readonly rootNamespaces: ReadonlySet<string>;
    readonly truncated: boolean;
}
/** Project the one-pass {@link CSharpProjectScan} into the
 *  {@link CSharpNamespaceEvidence} both import-resolution legs thread to the
 *  #1881 gate — one shape, two carriers (`ImportConfigs.csharpNamespaces` for
 *  the legacy DAG, `CsharpResolutionConfig.namespaces` for the scope resolver).
 *  Keeps the field mapping in one place so the two carriers can't drift. */
export declare function csharpScanToEvidence(scan: CSharpProjectScan): CSharpNamespaceEvidence;
/** Swift Package Manager module config */
export interface SwiftPackageConfig {
    /** Map of target name -> source directory path (e.g., "SiuperModel" -> "Package/Sources/SiuperModel") */
    targets: Map<string, string>;
}
/**
 * Parse tsconfig.json to extract path aliases.
 * Tries tsconfig.json, tsconfig.app.json, tsconfig.base.json in order.
 */
export declare function loadTsconfigPaths(repoRoot: string): Promise<TsconfigPaths | null>;
/**
 * Parse go.mod to extract module path.
 */
export declare function loadGoModulePath(repoRoot: string): Promise<GoModuleConfig | null>;
/** Parse composer.json to extract PSR-4 autoload mappings (including autoload-dev). */
export declare function loadComposerConfig(repoRoot: string): Promise<ComposerConfig | null>;
/**
 * Single BFS over a repo that collects BOTH .csproj configs and the set of
 * `namespace` declarations from `.cs` files.
 *
 * The csproj walk is cheap (a handful of project files); the namespace scan
 * is NOT — it opens and reads every `.cs` file in the repo to collect its
 * `namespace` declarations. That `.cs` read cost is the price of the #1881
 * gate, not a saving: collapsing the csproj and namespace walks into one BFS
 * avoids a second directory traversal, but the per-file `.cs` reads are new
 * work this scan introduces. Reads within a directory are issued in bounded
 * windows (see below); directories are still visited breadth-first.
 */
export declare function scanCSharpProject(repoRoot: string): Promise<CSharpProjectScan>;
export declare function loadSwiftPackageConfig(repoRoot: string): Promise<SwiftPackageConfig | null>;
/**
 * Bundled language-specific configs loaded once per ingestion run — the
 * result of {@link loadImportConfigs}, and every field's type is declared
 * above in this module.
 *
 * It lives here rather than in `import-resolvers/types.ts` (its consumer, via
 * `ResolveCtx`) so the dependency runs one way: the import-resolver types
 * import this bundle, and this module imports nothing from them. Homing the
 * producer's result type with the producer also keeps `import-resolvers/
 * types.ts` free of per-language names.
 */
export interface ImportConfigs {
    tsconfigPaths: TsconfigPaths | null;
    goModule: GoModuleConfig | null;
    composerConfig: ComposerConfig | null;
    swiftPackageConfig: SwiftPackageConfig | null;
    csharpConfigs: CSharpProjectConfig[];
    /** In-repo namespace evidence gating C# suffix-fallback resolution (#1881). */
    csharpNamespaces?: CSharpNamespaceEvidence;
}
/** Load all language-specific configs once for an ingestion run. */
export declare function loadImportConfigs(repoRoot: string): Promise<ImportConfigs>;
