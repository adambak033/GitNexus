/**
 * Route / fetch edge emission + exported-type-map helpers.
 *
 * The legacy call-resolution DAG that previously lived here (per-file type
 * inference → receiver inference → dispatch selection → MRO walk over the
 * legacy heritage map) was deleted in RING4-1 (#942): all languages now resolve
 * calls through the scope-resolution registry pipeline. What remains are the
 * language-agnostic edge emitters that are NOT part of call resolution:
 *
 *   - `processRoutesFromExtracted` — CALLS edges from framework routes
 *     (e.g. Laravel) to their controller methods.
 *   - `processNextjsFetchRoutes` / `extractConsumerAccessedKeys` — FETCHES edges
 *     from `fetch()` calls to Next.js Route nodes.
 *   - `buildExportedTypeMapFromGraph` — exported symbol → return/declared type
 *     map, consumed by the cross-file enrichment pass.
 */
import { KnowledgeGraph } from '../graph/types.js';
import type { SemanticModel, SymbolTableReader } from './model/index.js';
import type { ExtractedRoute, ExtractedFetchCall } from './workers/parse-worker.js';
import type { ExtractedDecoratorRoute } from './workers/parse-worker.js';
/** Per-file resolved type bindings for exported symbols.
 *  Consumed by the cross-file re-resolution / enrichment pass. */
export type ExportedTypeMap = Map<string, Map<string, string>>;
/** Record one exported graph node into the incremental ExportedTypeMap. */
export declare const accumulateExportedTypesFromParsedNode: (result: ExportedTypeMap, node: {
    id: string;
    properties?: Record<string, unknown>;
}, symbolTable: SymbolTableReader) => void;
/** Build ExportedTypeMap from graph nodes — used for the worker path where the
 *  sequential TypeEnv is not available in the main thread. Collects
 *  returnType/declaredType from exported symbols with known types. */
export declare function buildExportedTypeMapFromGraph(graph: KnowledgeGraph, symbolTable: SymbolTableReader): ExportedTypeMap;
/**
 * Create CALLS edges from extracted framework routes (e.g. Laravel) to their
 * controller methods. Runs for all languages — independent of call resolution.
 *
 * Resolution is registry-based (RING4-2 #943 retired the tiered resolver):
 *   - Controller: **qualified-first** (see {@link resolveControllerByQualifiedName}).
 *     When the routes file disambiguated the controller, the Laravel extractor
 *     threads `route.controllerQualifiedName` (a `use` import — incl. aliased
 *     `use … as X;` — or an inline qualified `::class`, normalized to the dot-
 *     joined key shape). The emitter resolves it by direct qualified lookup, or
 *     by PSR-4 file-path disambiguation when PHP's statement-form namespace left
 *     the registry keyed only by the short name — either way picking the
 *     specific class even when the short name is globally duplicated (the common
 *     admin/public `OrderController` split) or aliased. It falls back to the
 *     global short-name lookup (`lookupClassByName`), which still skips on
 *     ambiguity (`length !== 1`) — so a bare, genuinely ambiguous short name
 *     with no `use`/FQN correctly produces no (wrong) edge.
 *   - Method: resolved within the controller's own file via the symbol table
 *     (the legacy emitter only accepted same-file method resolutions).
 *
 * Edge confidence is a flat {@link ROUTE_EDGE_CONFIDENCE}. Route CALLS edges
 * are gated downstream by the process-trace (`MIN_TRACE_CONFIDENCE`) and
 * large-graph community (`MIN_CONFIDENCE_LARGE`) thresholds (both 0.5); a
 * resolved edge lands at exactly 0.5 and passes (`>= 0.5`). The guessed-method
 * fallback edge (`× 0.8` = 0.4) sits below the gate and is excluded from those
 * passes — acceptable for an edge whose target method could not be resolved.
 */
export declare const processRoutesFromExtracted: (graph: KnowledgeGraph, extractedRoutes: ExtractedRoute[], model: SemanticModel, onProgress?: (current: number, total: number) => void) => Promise<void>;
/**
 * Resolve each route's handler to a real symbol UID, keyed by the route's
 * `(method, url)` identity (`routeNodeKey` — the same key the routes phase uses
 * for the `Route` node). This is the Part 2 (#2138) groundwork that lets
 * `HttpRouteExtractor.extractProvidersGraph` read the handler symbol from the
 * graph instead of re-parsing source via `getDetections()`.
 *
 * Two route shapes, one resolution target — `(filePath, name) → nodeId`:
 *   - Laravel framework routes (`ExtractedRoute`) carry `controllerName` +
 *     `methodName`; resolve the controller (qualified-first) then the method in
 *     the controller's own file (mirrors `processRoutesFromExtracted`).
 *   - Decorator routes (`ExtractedDecoratorRoute`, e.g. Spring/FastAPI) carry
 *     `handlerName` (the decorated method, captured at extraction); resolve it
 *     directly in the route's own file.
 *
 * First-writer-wins per route identity, matching the routes phase's dedup (it
 * keeps the first route registered for a `(method, url)` key and counts the rest
 * as duplicates). The first route to claim a key reserves it **even when its
 * handler is unresolvable**, so a later same-key route can never stamp its
 * handler onto the first route's Route node (the routes phase made that first
 * route the node-winner). Keying is `routeNodeKey(method, url)` (#2289): a
 * same-URL multi-verb pair (`GET /x` + `POST /x`) resolves two handlers, one per
 * node; method-less / wildcard routes key by URL alone, byte-identical to the
 * pre-#2289 behavior. Routes whose handler cannot be *uniquely* resolved (no
 * name, zero matches, or an ambiguous same-name match) carry no
 * `handlerSymbolId`; the extractor then falls back to source scan for that route
 * (fail-open, no regression, never a wrong handler).
 */
export declare function resolveRouteHandlerSymbols(model: SemanticModel, extractedRoutes: readonly ExtractedRoute[], decoratorRoutes: readonly ExtractedDecoratorRoute[]): Map<string, string>;
/**
 * Extract property access keys from a consumer file's source code near fetch calls.
 *
 * Looks for destructuring (`const { data } = await res.json()`), property access
 * (`response.data`), and optional chaining (`data?.key`). Returns deduplicated
 * top-level property names accessed on the response. Scans the whole file, so
 * all accessed keys are attributed to each fetch — acceptable for regex-based
 * extraction.
 */
export declare const extractConsumerAccessedKeys: (content: string) => string[];
/**
 * Create FETCHES edges from extracted fetch() calls to matching Route nodes.
 * When consumerContents is provided, extracts property access patterns from
 * consumer files and encodes them in the edge reason field.
 *
 * Matching stays URL-only (#2289): a verb-less consumer (a `fetch()` call has
 * no statically-known HTTP method) matches a route by URL and connects to
 * **every** Route node sharing that URL — i.e. both the `GET /x` and `POST /x`
 * nodes when a URL carries multiple verbs. `routeUrlToKeys` therefore maps each
 * route URL to the list of `routeNodeKey` identities at that URL; a single-verb
 * (or method-less) URL has a one-element list, keeping edges byte-identical to
 * the pre-#2289 behavior.
 */
export declare const processNextjsFetchRoutes: (graph: KnowledgeGraph, fetchCalls: ExtractedFetchCall[], routeUrlToKeys: Map<string, string[]>, // routeURL → route node keys at that URL
consumerContents?: Map<string, string>) => void;
