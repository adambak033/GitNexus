/**
 * FastAPI router-prefix detection — pure functions, no worker thread.
 *
 * NOT A WORKER. This module exports plain synchronous functions; it
 * does not import `worker_threads`, does not call `parentPort`, and
 * is not a new worker entry point. It lives next to the other route
 * extractors (expo, nextjs, php, laravel) for that reason.
 *
 * The implementation was historically inlined in `workers/parse-worker.ts`,
 * but parse-worker.ts is itself the worker entry point and cannot be
 * loaded from the main thread (see the same constraint used by
 * `test/unit/call-attribution-issue-1166.test.ts`). Splitting the pure
 * extraction here lets unit tests import the function directly without
 * booting a worker, satisfying DoD §2.7.
 *
 * Worker phase is per-file, so the heavy cross-file resolution lives in
 * `pipeline-phases/parse-impl.ts`. Here we only extract two raw record
 * kinds and let the pipeline aggregate them across files:
 *
 *   • {@link ExtractedRouterInclude} — every
 *     `<host>.include_router(<routerExpr>, prefix='/x')` site, where
 *     `<routerExpr>` is either `<module>.router` (Shape A) or a bare
 *     local name (Shape B). `<host>` is intentionally unconstrained:
 *     production code uses `app`, `api`, `application`, `asgi_app`,
 *     etc., and the call shape (`include_router` invoked with a
 *     `prefix=` keyword) is specific enough on its own.
 *
 *   • {@link ExtractedRouterImport} — every
 *     `from <module> import router [as <alias>]`, captured for both
 *     absolute and relative module paths (`from .calls import …`).
 *     parse-impl uses the imports to resolve Shape-B local names back
 *     to the file that declares the router.
 *
 * Module keying is two-tiered to avoid prefix bleed between same-named
 * files in different packages (e.g. `api/users.py` vs `admin/users.py`):
 *
 *   • short key — basename without `.py`                  (`users`)
 *   • long  key — `<parent-dir>/<basename>`               (`api/users`)
 *
 * Imports always carry the short key and, when the module path was
 * multi-segment, also the long key. parse-impl matches against the
 * long key first and falls back to the short key, so cross-package
 * collisions are eliminated for Shape B and minimised for Shape A.
 *
 * The functions in this module are pure (no Worker / parentPort
 * dependency) so they can be unit-tested directly without booting a
 * worker thread.
 */
/**
 * One `<host>.include_router(<routerExpr>, prefix='/x')` site.
 *
 * `routerExpr` is the raw text of the first argument — either
 * `<module>.router` (Shape A) or a bare local name (Shape B).
 * parse-impl resolves Shape B against {@link ExtractedRouterImport}
 * records emitted by the same file.
 */
export interface ExtractedRouterInclude {
    filePath: string;
    routerExpr: string;
    prefix: string;
    lineNumber: number;
}
/**
 * One `from <module> import router [as <alias>]` discovered in a
 * Python file.
 *
 * `moduleKey` is the short key (last `.`-segment of the module path,
 * e.g. `api.users` → `users`). `moduleKeyLong` is the long key (last
 * two segments joined with `/`, e.g. `api/users`); it is the empty
 * string / undefined when the import is single-segment (e.g.
 * `from users import router`) or pure-dots (e.g. `from . import
 * router`). The long key, when present, gives parse-impl a precise
 * way to bind a Shape-B `include_router` call to exactly one Python
 * file even when other packages contain a same-named module.
 */
export interface ExtractedRouterImport {
    filePath: string;
    localName: string;
    moduleKey: string;
    moduleKeyLong?: string;
}
/**
 * One `from <package> import <module>` discovered in a Python file
 * where `<module>` is later used as a Shape-A include receiver
 * (`<host>.include_router(<module>.router, prefix='/x')`). Without
 * this record parse-impl would have to fall back to the short key
 * `<module>`, which collides between e.g. `api/users.py` and
 * `admin/users.py`. The record carries the long key
 * (`<package>/<module>`) so parse-impl can pin the prefix onto the
 * exact source file.
 *
 * Only emitted when the import path was multi-segment (a single
 * `from users import users` would yield no long key). All fields
 * carry the same module-key semantics as
 * {@link ExtractedRouterImport}.
 */
export interface ExtractedRouterModuleAlias {
    filePath: string;
    /** Local name in the importing file (== imported name or its alias). */
    localName: string;
    /** Long key (`<parent>/<stem>`) — non-empty for every emitted record. */
    moduleKeyLong: string;
}
export interface ExtractedRouterConstructorPrefix {
    filePath: string;
    prefix: string;
}
/**
 * Last `.`-separated segment of a (possibly relative) Python module
 * path. Strips any leading dots first so `from .api.assistant import
 * …` and `from api.assistant import …` both yield `assistant`.
 * Pure-dot inputs (`.`, `..`) have no segment and return the empty
 * string; callers should skip empty results.
 */
export declare function lastDottedSegment(text: string): string;
/**
 * Last two `.`-separated segments of a (possibly relative) module
 * path joined with `/`, e.g. `api.users` → `api/users`. Mirrors the
 * long-key shape used for files (`api/users.py` → `api/users`).
 * Returns the empty string when no parent segment is available
 * (single-segment imports or pure dots); callers should fall back
 * to the short key in that case.
 */
export declare function lastTwoSegmentsAsPath(text: string): string;
/**
 * Scan a single Python file's source text for FastAPI router
 * `include_router` sites and `from <module> import router` imports,
 * appending raw records to the supplied collectors.
 *
 * `outModuleAliases` is optional: when supplied, every multi-segment
 * `from <pkg> import <name>` (other than `router` itself) is recorded
 * as a module alias so parse-impl can pin Shape-A
 * `<name>.include_router(...)` calls onto the exact module file. When
 * omitted, the function preserves the pre-existing behaviour and
 * skips the alias collection — this keeps the function signature
 * back-compat with older callers (and the parse-cache replay path).
 */
export declare function extractFastAPIRouterBindings(filePath: string, content: string, outIncludes: ExtractedRouterInclude[], outImports: ExtractedRouterImport[], outModuleAliases?: ExtractedRouterModuleAlias[], outConstructorPrefixes?: ExtractedRouterConstructorPrefix[]): void;
