/**
 * Shared route-path normalization.
 *
 * Extracted from the routes phase so both the routes phase (which creates the
 * `Route` graph node, keyed by `(method, url)` via `routeNodeKey` — #2289) and
 * the parse phase (which resolves each route's handler symbol and needs the
 * SAME key to associate the resolved id back to the route) can compute an
 * identical route identity without a phase-to-phase import cycle. Pure string
 * logic, no dependencies.
 */
/**
 * Join a route's path with its (optional) prefix into a normalized,
 * leading-slash URL used as the Route node identity. Collapses duplicate
 * slashes and strips trailing ones; an empty result degrades to `/`.
 */
export declare function normalizeExtractedRoutePath(routePath: string, prefix: string | null): string;
/**
 * Canonicalize a route's HTTP verb for persistence on the Route node and for
 * the route identity key. Returns an upper-cased standard method, `'*'` for a
 * method-agnostic route (e.g. a Django function view), or `undefined` when the
 * value is not a real HTTP verb. Laravel `Route::resource` / `apiResource`
 * surface values like `resource` / `apiResource` (they expand to several verbs
 * at runtime), so they come back `undefined` — keeping the column clean and
 * letting the contract extractor fall back to its source-scan path.
 */
export declare function normalizeRouteMethod(raw: string | null | undefined): string | undefined;
/**
 * The Route node identity (#2289): `(method, path)` when the verb is known and
 * specific, falling back to URL-only when the method is `undefined` (filesystem
 * routes, Laravel `resource`/`apiResource`) or `'*'` (method-agnostic routes,
 * e.g. Django function views). The URL-fallback keeps those byte-identical to
 * the pre-#2289 URL-only ids, so only genuine declaration-style multi-verb
 * routes (`GET /x` + `POST /x`) split into separate nodes.
 *
 * Used by the routes phase (node id + registry key), the processes phase
 * (ENTRY_POINT_OF), and the handler-symbol resolver — all three must key
 * identically.
 */
export declare function routeNodeKey(method: string | undefined, url: string): string;
