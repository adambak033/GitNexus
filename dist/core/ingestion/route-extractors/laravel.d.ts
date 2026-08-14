import type Parser from 'tree-sitter';
export interface ExtractedRoute {
    filePath: string;
    httpMethod: string;
    routePath: string | null;
    routeName: string | null;
    controllerName: string | null;
    /**
     * The controller class's normalized (dot-joined) fully-qualified name when
     * the routes file disambiguates it — via a `use` import (`use App\…\X;` or
     * `use App\…\X as Y;`) or an inline qualified `::class` reference. Resolved
     * to the same key shape the type registry stores (`normalizeQualifiedName`),
     * so the emitter can `lookupClassByQualifiedName` to disambiguate
     * same-short-name controllers. `null`/undefined when only a bare short name
     * is available — the emitter then falls back to short-name resolution.
     */
    controllerQualifiedName?: string | null;
    methodName: string | null;
    middleware: string[];
    prefix: string | null;
    lineNumber: number;
}
export declare function extractLaravelRoutes(tree: Parser.Tree, filePath: string): ExtractedRoute[];
