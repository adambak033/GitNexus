/**
 * Hand-rolled dispatch-guard route extractor (JavaScript / TypeScript).
 *
 * Every route extractor before this one recognises a route because a FRAMEWORK
 * declares it: a decorator, a `Route::get()` call, a filesystem convention. A
 * server written against raw `node:http` declares its routes the only way the
 * language offers — by COMPARING the request path to a literal:
 *
 *     if (req.method === 'GET' && pathname === '/api/live/portfolio') { … }
 *
 * That is a route definition in every sense that matters to this graph: it has a
 * path, a verb, and a handler. GitNexus simply had no rule that could see it, so
 * `route_map` answered "No routes found in this project" for a repo with
 * seventeen route modules and 113 such comparisons — the same confident-empty
 * failure this whole change set is about, one tool wide.
 *
 * PRECISION OVER RECALL, deliberately. A missed route is a coverage limit; an
 * invented route is a false fact, and `route_map` presents its output as fact.
 * So every rule here requires the comparison to be against something that is
 * demonstrably a request path, and anything that cannot be converted cleanly is
 * dropped rather than guessed at. Specifically NOT extracted:
 *
 *   - `pathname.startsWith('/api/')` — a namespace test ("do I own this?"),
 *     not a route. Minting `/api` would claim a route nobody serves.
 *   - a bare `pathname === '/'` with no verb — far more often a normalisation
 *     branch (`pathname === '/' ? '/index.html' : pathname`) than a route. With
 *     a verb alongside it the intent is unambiguous, so that form IS extracted.
 *   - any regex whose body is not a literal path plus single-segment wildcards.
 *
 * One consequence worth stating rather than discovering: a single-page app that
 * branches on `location.pathname === '/settings'` mints a Route too. That is
 * intentional — it is the same claim a Next.js filesystem route makes, that this
 * file serves this path — and it keeps the rule from needing to guess whether a
 * comparison is "backend enough". It does mean `route_map` on a SPA reports
 * client routes alongside API ones, distinguishable by their `source`.
 *
 * @module route-extractors/dispatch-guard
 */
import type Parser from 'tree-sitter';
import type { ExtractedDecoratorRoute } from '../workers/parse-worker.js';
/** Provenance stamped on the Route node, in place of `decorator-<name>`. */
export declare const DISPATCH_GUARD_SOURCE = "dispatch-guard-route";
/**
 * Convert an anchored regex used as a path test into a route path, or `null` if
 * any part of it is not cleanly representable.
 *
 * `^\/api\/research-runs\/([^/]+)$` → `/api/research-runs/{param1}`
 *
 * Only single-segment wildcards are recognised — see {@link SEGMENT_WILDCARD}.
 * Anything else — an optional group, an alternation, a bare `.*` — bails,
 * because a route path is a claim about what the server serves and a
 * mistranslated pattern is a wrong one. A capture group around anything OTHER
 * than a segment wildcard still bails: `(.+)` spans slashes, so it is not one
 * segment and cannot be one `{param}`.
 */
export declare function regexToRoutePath(source: string): string | null;
/**
 * Extract routes declared by path-comparison dispatch from one JS/TS file.
 *
 * Returns the same {@link ExtractedDecoratorRoute} transport every AST-level
 * route extractor returns — a route is a route once it has a path, a verb and a
 * handler, and reusing the transport means the routes phase, the `(method, url)`
 * dedup and the handler-symbol resolution all apply unchanged. `source`
 * distinguishes the provenance, which is the part that actually differs: a
 * decorator route is DECLARED, a dispatch-guard route is INFERRED from a
 * comparison.
 */
export declare function extractDispatchGuardRoutes(tree: Parser.Tree, filePath: string, lineOffset?: number): ExtractedDecoratorRoute[];
/** The minimum a route needs for reconciliation — structural, not nominal. */
interface ReconcilableRoute {
    readonly routePath: string;
    readonly httpMethod: string;
    readonly source?: string;
}
/**
 * Drop a dispatch-guard route whose URL is claimed WITH a verb somewhere in the
 * repository.
 *
 * The idiom that makes this necessary is the split route table: one module lists
 * every path it recognises (`isKnownApiPath`, or a `match(method, pathname)`
 * that ORs them all) so the dispatcher can 404 early, and separate modules
 * handle each path by verb. Both are path comparisons and both are real, but
 * only the second is a route in the sense `route_map` reports — the first is a
 * membership test.
 *
 * Left alone this doubles the map: measured on the reporting repo, 94 routes of
 * which 34 were the table's verb-less shadow of a route already listed with its
 * verb and its true handler. Reconciling per-FILE cannot see it, because the
 * table and the handlers are different files; only the whole registry can.
 *
 * Applies to dispatch-guard routes only. A framework route with no verb is
 * method-agnostic BY DECLARATION (a Django function view, a Laravel resource),
 * which is a fact rather than a weaker observation, and must not be dropped.
 */
export declare function reconcileDispatchGuardRoutes<T extends ReconcilableRoute>(routes: readonly T[]): T[];
export {};
