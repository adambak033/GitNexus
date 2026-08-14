import { SupportedLanguages } from '../../../_shared/index.js';
import type { SkippedPath } from './clone-safety.js';
import type { ExtractedRouterConstructorPrefix, ExtractedRouterInclude, ExtractedRouterImport, ExtractedRouterModuleAlias } from '../route-extractors/fastapi-router-bindings.js';
import { type MixedChainStep } from '../utils/call-analysis.js';
import type { ConstructorBinding } from '../type-env.js';
import type { NodeLabel, ParameterTypeClass } from '../../../_shared/index.js';
import type { ParsedFile } from '../../../_shared/index.js';
import { type ExtractedRoute } from '../route-extractors/laravel.js';
import type { SharedSpringType } from '../route-extractors/spring-shared.js';
import { type CfgSkipCounts } from '../cfg/collect.js';
export type { ExtractedRoute } from '../route-extractors/laravel.js';
interface ParsedNode {
    id: string;
    label: string;
    properties: {
        name: string;
        filePath: string;
        startLine: number;
        endLine: number;
        language: SupportedLanguages;
        isExported: boolean;
        astFrameworkMultiplier?: number;
        astFrameworkReason?: string;
        description?: string;
        [key: string]: unknown;
    };
}
interface ParsedRelationship {
    id: string;
    sourceId: string;
    targetId: string;
    type: 'DEFINES' | 'HAS_METHOD' | 'HAS_PROPERTY';
    confidence: number;
    reason: string;
}
interface ParsedSymbol {
    filePath: string;
    name: string;
    nodeId: string;
    type: NodeLabel;
    qualifiedName?: string;
    parameterCount?: number;
    requiredParameterCount?: number;
    parameterTypes?: string[];
    parameterTypeClasses?: ParameterTypeClass[];
    returnType?: string;
    declaredType?: string;
    templateArguments?: string[];
    ownerId?: string;
    visibility?: string;
    isStatic?: boolean;
    isReadonly?: boolean;
    isAbstract?: boolean;
    isFinal?: boolean;
    isDeleted?: boolean;
    annotations?: string[];
}
export interface ExtractedCall {
    filePath: string;
    calledName: string;
    /** generateId of enclosing function, or generateId('File', filePath) for top-level */
    sourceId: string;
    /** From call AST; omitted for some seeds (e.g. Java `::`) so arity filter is skipped */
    argCount?: number;
    /** Discriminates free function calls from member/constructor calls */
    callForm?: 'free' | 'member' | 'constructor';
    /** Simple identifier of the receiver for member calls (e.g., 'user' in user.save()) */
    receiverName?: string;
    /** Resolved type name of the receiver (e.g., 'User' for user.save() when user: User) */
    receiverTypeName?: string;
    /**
     * Unified mixed chain when the receiver is a chain of field accesses and/or method calls.
     * Steps are ordered base-first (innermost to outermost). Examples:
     *   `svc.getUser().save()`        → chain=[{kind:'call',name:'getUser'}], receiverName='svc'
     *   `user.address.save()`         → chain=[{kind:'field',name:'address'}], receiverName='user'
     *   `svc.getUser().address.save()` → chain=[{kind:'call',name:'getUser'},{kind:'field',name:'address'}]
     * Length is capped at MAX_CHAIN_DEPTH. Deliberately NOT restating the number
     * here: this comment previously hardcoded `(3)` and would have drifted the
     * moment the cap moved, which is exactly the kind of stale doc that reads as
     * authoritative.
     */
    receiverMixedChain?: MixedChainStep[];
    argTypes?: (string | undefined)[];
}
export interface ExtractedAssignment {
    filePath: string;
    /** generateId of enclosing function, or generateId('File', filePath) for top-level */
    sourceId: string;
    /** Receiver text (e.g., 'user' from user.address = value) */
    receiverText: string;
    /** Property name being written (e.g., 'address') */
    propertyName: string;
    /** Resolved type name of the receiver if available from TypeEnv */
    receiverTypeName?: string;
    /** 1-indexed line number of the assignment site (used for per-site dedup) */
    line?: number;
}
export interface ExtractedFetchCall {
    filePath: string;
    fetchURL: string;
    lineNumber: number;
}
export interface FetchWrapperDef {
    filePath: string;
    functionName: string;
}
export interface ExtractedDecoratorRoute {
    filePath: string;
    routePath: string;
    httpMethod: string;
    decoratorName: string;
    lineNumber: number;
    /**
     * Decorator receiver identifier (e.g. `router` for `@router.get(...)`,
     * `app` for `@app.get(...)`). Used by parse-impl to decide which routes
     * participate in `include_router(prefix=...)` joining.
     */
    decoratorReceiver?: string;
    /**
     * Raw text of a non-literal decorator path argument (`#2391`), e.g.
     * `API_V1_WIDGETS_GET` or `API_V1 + "/widgets"`. Present only when the
     * decorator's first argument was NOT a string literal, in which case
     * `routePath` is empty and parse-impl resolves the constant cross-file (or
     * drops the route on failure). Absent for ordinary string-literal routes.
     */
    routePathExpr?: string;
    /**
     * Parsed operand list for {@link routePathExpr} — an identifier reference or a
     * `+`-concatenation, in the {@link Operand} shape the constant resolver folds.
     * `undefined` when the expression was not a foldable string form (e.g. an
     * attribute access), in which case the route is dropped at resolution.
     */
    routePathOperands?: Operand[];
    /**
     * FastAPI `app.include_router(prefix='/x')` prefix that applies to
     * this route. Filled by parse-impl after cross-file aggregation; the
     * routes phase joins it via `normalizeExtractedRoutePath`. `null` /
     * absent ⇒ no prefix applies.
     */
    prefix?: string | null;
    /**
     * Name of the handler the route decorator sits on (the decorated
     * method/function — e.g. `create` for `@PostMapping("/orders") Order create()`).
     * Captured at extraction where the decorated definition node is in hand, so
     * the routes phase can resolve it to a real handler symbol UID via the
     * SemanticModel (same `(filePath, name) → nodeId` lookup Laravel routes use).
     * Absent when the extractor could not identify the decorated definition;
     * resolution then falls back (the Route node simply carries no handlerSymbolId).
     */
    handlerName?: string;
    /**
     * Provenance for the `HANDLES_ROUTE` edge, overriding the default
     * `decorator-<decoratorName>`. Present when the route was extracted from a
     * shape that is not a decorator at all — today, JS/TS dispatch guards
     * (`route-extractors/dispatch-guard.ts`), where the route is INFERRED from a
     * path comparison rather than DECLARED by an annotation. That distinction is
     * the only thing that differs downstream, so it travels as a field instead of
     * as a parallel extraction channel.
     */
    source?: string;
}
/**
 * One Python file's module-level string constants (#2391), used by parse-impl to
 * resolve non-literal decorator route paths cross-file. `constants` is the
 * `Map`-based {@link ModuleConstants} shape — it survives the worker
 * `postMessage` boundary (structured clone) and the parse cache
 * (`mapReplacer`/`mapReviver`) without conversion.
 */
export interface ExtractedModuleConstants {
    filePath: string;
    constants: ModuleConstants;
}
export interface ExtractedToolDef {
    filePath: string;
    toolName: string;
    description: string;
    lineNumber: number;
    handlerNodeId?: string;
}
export interface ExtractedORMQuery {
    filePath: string;
    orm: 'prisma' | 'supabase';
    model: string;
    method: string;
    lineNumber: number;
}
/** Constructor bindings keyed by filePath for cross-file type resolution */
export interface FileConstructorBindings {
    filePath: string;
    bindings: ConstructorBinding[];
}
/** All-scope type bindings from TypeEnv — includes function-local scopes.
 *  Used by BindingAccumulator for cross-file type propagation (Phase 9+).
 *
 *  Carries only file-scope entries (`scope = ''`). Serializing function-scope
 *  bindings over IPC cost ~4.9 MB with zero downstream consumers.
 *  `parse-worker.ts` now iterates only `typeEnv.fileScope()` and the
 *  sequential path's `type-env.ts::flush()` is also narrowed to file
 *  scope — see the `BindingAccumulator` class JSDoc for the unified
 *  narrowing contract across both execution paths.
 *
 *  **Phase 9 reversion checklist** (when a downstream consumer of
 *  function-scope bindings lands):
 *    1. Change the loop in `runParseJob` below from `typeEnv.fileScope()`
 *       back to `typeEnv.allScopes()`.
 *    2. Emit three-element tuples `[scope, varName, typeName]`.
 *    3. Widen the `bindings` field on this interface back to
 *       `[string, string, string][]`.
 *    4. Update the pipeline adapter in `pipeline.ts` to unpack three
 *       elements and populate `BindingEntry.scope` from the first tuple
 *       element instead of hardcoding `''`.
 *    5. Also revert `type-env.ts::flush()` to iterate `env` instead of
 *       just `FILE_SCOPE` if the sequential path needs function-scope data too.
 *    6. Consider renaming this interface back to `FileAllScopeBindings`
 *       along with widening. */
export interface FileScopeBindings {
    filePath: string;
    /** [varName, typeName] pairs from the file scope only. */
    bindings: [string, string][];
}
export interface ParseWorkerResult {
    nodes: ParsedNode[];
    relationships: ParsedRelationship[];
    symbols: ParsedSymbol[];
    calls: ExtractedCall[];
    assignments: ExtractedAssignment[];
    routes: ExtractedRoute[];
    fetchCalls: ExtractedFetchCall[];
    fetchWrapperDefs: FetchWrapperDef[];
    decoratorRoutes: ExtractedDecoratorRoute[];
    routerIncludes: ExtractedRouterInclude[];
    routerImports: ExtractedRouterImport[];
    routerConstructorPrefixes?: ExtractedRouterConstructorPrefix[];
    /**
     * Optional. Project-wide `SharedSpringType` view of route-defining
     * class/interface declarations, produced by the provider's
     * `extractRouteInheritanceTypes` hook (Java/Spring). parse-impl aggregates
     * these and runs a cross-file pass that resolves interface-inherited routes
     * into additional `decoratorRoutes` (#2288). Optional for cache backward
     * compatibility; consumers must guard with `?? []`.
     */
    springTypes?: SharedSpringType[];
    /**
     * Optional. `from <pkg> import <module>` records from Python files
     * where `<module>` is later used as a Shape-A include receiver
     * (`<host>.include_router(<module>.router, prefix='/x')`). parse-impl
     * uses these to promote Shape-A short-key entries to long keys, so
     * same-named modules in different packages don't share prefixes.
     * Optional for cache backward compatibility (older cache entries
     * predate the field; consumers must guard with `if (… ?? [])`).
     */
    routerModuleAliases?: ExtractedRouterModuleAlias[];
    /**
     * Per-file Python module-level string constants (#2391). parse-impl aggregates
     * these into a repo-wide, file-path-keyed map and resolves each decorator
     * route's non-literal path expression against it. Optional for cache backward
     * compatibility (older entries predate the field; consumers guard with `?? []`).
     */
    moduleConstants?: ExtractedModuleConstants[];
    toolDefs: ExtractedToolDef[];
    ormQueries: ExtractedORMQuery[];
    constructorBindings: FileConstructorBindings[];
    /** All-scope type bindings from TypeEnv for BindingAccumulator (includes function-local). */
    fileScopeBindings: FileScopeBindings[];
    /**
     * Per-file `ParsedFile` artifacts from the new scope-based resolution
     * pipeline (RFC #909 Ring 2). Empty unless the file's provider implements
     * `emitScopeCaptures` — default for every language today, so this is
     * additive and leaves the legacy DAG untouched. Consumed by #921's
     * finalize-orchestrator.
     */
    parsedFiles: ParsedFile[];
    skippedLanguages: Record<string, number>;
    /**
     * Files whose parse output carried a value the structured-clone algorithm
     * couldn't serialize across the worker boundary (#2112). The clone-safety
     * net stripped or dropped the offending value so the result could be
     * delivered; these paths are surfaced to the operator so the (rare) data
     * loss is visible. Optional for cache backward compatibility — older cache
     * entries predate the field; consumers must guard with `?? []`.
     */
    skippedPaths?: SkippedPath[];
    /**
     * Per-language CFG-bearing functions skipped during the worker walk, bucketed
     * by reason (#2195): too-many-lines, too-deeply-nested (the proactive
     * depth-guard bail), or build-error. Survives the parse cache (a small number
     * map, kept by `...result` in slimParseWorkerResultsForCache) and is merged +
     * logged per-language in `dispatchChunkParse` (alongside `skippedLanguages`),
     * so a CFG coverage gap is visible. Like that sibling telemetry the warn is
     * emitted for freshly-parsed chunks, not re-emitted on a warm cache hit.
     * Optional for cache backward-compatibility — older shards predate it.
     */
    cfgSkipped?: Record<string, CfgSkipCounts>;
    fileCount: number;
}
export interface ParseWorkerInput {
    path: string;
    content: string;
}
/**
 * Extract ORM query calls from file content via regex.
 * Appends results to the provided array (avoids allocation when no matches).
 */
export declare function extractORMQueries(filePath: string, content: string, out: ExtractedORMQuery[]): void;
import { type ModuleConstants, type Operand } from '../route-extractors/python-const-resolver.js';
