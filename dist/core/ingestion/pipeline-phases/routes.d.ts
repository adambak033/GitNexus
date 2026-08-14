/**
 * Phase: routes
 *
 * Builds the route registry (Next.js, Expo, PHP, Laravel, decorator-based)
 * and creates Route graph nodes + HANDLES_ROUTE edges.
 * Also links middleware, processes fetch() calls, and scans HTML templates.
 *
 * @deps    parse
 * @reads   allPaths, allExtractedRoutes, allDecoratorRoutes, allFetchCalls
 * @writes  graph (Route nodes, HANDLES_ROUTE, FETCHES_FROM edges)
 * @output  routeRegistry, handlerContents
 */
import type { PipelinePhase } from './types.js';
export interface RouteEntry {
    filePath: string;
    source: string;
    /**
     * The route's URL path (leading-slash, prefix-joined). This is the Route
     * node's `name`. Stored explicitly because the registry is keyed by the
     * `(method, url)` identity (`routeNodeKey`), so the key is no longer the URL
     * — downstream URL consumers (middleware/fetch matching) read this instead.
     */
    url: string;
    /**
     * HTTP verb for this route when ingestion knows it structurally
     * (Spring/Laravel framework routes and decorator routes carry
     * `httpMethod`; filesystem-derived routes — Next.js/Expo/PHP file
     * routes — do not, so this stays undefined for them). Persisted onto
     * the Route node so downstream contract extraction can read the verb
     * from the graph instead of re-parsing the handler source.
     */
    method?: string;
}
export interface RoutesOutput {
    routeRegistry: Map<string, RouteEntry>;
}
export interface TemplateFetchCall {
    filePath: string;
    fetchURL: string;
    lineNumber: number;
}
export declare const isTemplateRouteCandidate: (filePath: string) => boolean;
export declare function extractTemplateStaticFetchCalls(filePath: string, content: string, namedRouteUrls?: ReadonlyMap<string, string>): TemplateFetchCall[];
export declare const routesPhase: PipelinePhase<RoutesOutput>;
