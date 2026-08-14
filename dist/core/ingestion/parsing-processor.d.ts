import { KnowledgeGraph } from '../graph/types.js';
import type { SymbolTableWriter } from './model/index.js';
import { type ExportedTypeMap } from './call-processor.js';
import type { ParsedFile } from '../../_shared/index.js';
import { WorkerPool } from './workers/worker-pool.js';
import type { ParseWorkerResult, ExtractedRoute, ExtractedFetchCall, ExtractedDecoratorRoute, ExtractedModuleConstants, ExtractedToolDef, FileScopeBindings, ExtractedORMQuery, FetchWrapperDef } from './workers/parse-worker.js';
import type { ExtractedRouterConstructorPrefix, ExtractedRouterImport, ExtractedRouterInclude, ExtractedRouterModuleAlias } from './route-extractors/fastapi-router-bindings.js';
import type { SharedSpringType } from './route-extractors/spring-shared.js';
export type FileProgressCallback = (current: number, total: number, filePath: string) => void;
export interface WorkerExtractedData {
    routes: ExtractedRoute[];
    fetchCalls: ExtractedFetchCall[];
    fetchWrapperDefs: FetchWrapperDef[];
    decoratorRoutes: ExtractedDecoratorRoute[];
    routerIncludes: ExtractedRouterInclude[];
    routerImports: ExtractedRouterImport[];
    routerConstructorPrefixes: ExtractedRouterConstructorPrefix[];
    routerModuleAliases: ExtractedRouterModuleAlias[];
    /** Per-file Python module constants for cross-file route-path resolution (#2391). */
    moduleConstants: ExtractedModuleConstants[];
    toolDefs: ExtractedToolDef[];
    ormQueries: ExtractedORMQuery[];
    /** Project-wide Spring class/interface views for the #2288 inheritance pass. */
    springTypes: SharedSpringType[];
    fileScopeBindings: FileScopeBindings[];
    /**
     * Per-file `ParsedFile` artifacts from the new scope-based resolution
     * pipeline (RFC #909 Ring 2). Empty until a provider implements
     * `emitScopeCaptures` — additive to the legacy DAG path. Aggregated
     * from every worker chunk; consumed downstream by #921's
     * finalize-orchestrator.
     */
    parsedFiles: ParsedFile[];
}
/**
 * Merge a list of `ParseWorkerResult`s into the running graph + symbol
 * table state and produce the chunk-aggregated `WorkerExtractedData`.
 *
 * Split out from the worker-parse path so the same merge logic can
 * be applied to both freshly-parsed worker output AND cached worker
 * output replayed during incremental analyze. Idempotent on the
 * accumulator fields (push-only); idempotent on graph if the caller
 * starts from a clean graph (otherwise duplicate `addNode` calls are
 * silently no-op'd by `KnowledgeGraph`).
 */
export declare const mergeChunkResults: (graph: KnowledgeGraph, symbolTable: SymbolTableWriter, chunkResults: readonly ParseWorkerResult[], exportedTypeMap?: ExportedTypeMap) => WorkerExtractedData;
/**
 * Dispatch a chunk's files to the worker pool and return the RAW per-worker
 * results, WITHOUT merging them into the graph. Split out from
 * {@link processParsing} so the parse loop can overlap one chunk's
 * merge (main-thread, via {@link mergeChunkResults}) with the NEXT chunk's
 * worker parse — the merge is the only remaining serial main-thread step once
 * ParsedFile serialization moved into the workers (#worker-idle pipelining).
 * Returns `[]` for an all-unparseable chunk (the caller merges `[]` → empty).
 */
export declare const dispatchChunkParse: (files: {
    path: string;
    content: string;
}[], workerPool: WorkerPool, onFileProgress?: FileProgressCallback, 
/** Populated in-place with the raw results (parse-cache capture). */
outRawResults?: ParseWorkerResult[], 
/**
 * Content hash of this parse chunk. When set, the workers tag their durable
 * ParsedFile shards with it so a future warm cache hit can restore them
 * (#2038). `undefined` ⇒ no durable write (tests / no-cache path).
 */
chunkHash?: string) => Promise<ParseWorkerResult[]>;
export declare const processParsing: (graph: KnowledgeGraph, files: {
    path: string;
    content: string;
}[], symbolTable: SymbolTableWriter, workerPool: WorkerPool, onFileProgress?: FileProgressCallback, 
/**
 * Optional out-parameter for the incremental parse cache. When provided,
 * populated with the raw `ParseWorkerResult[]` from the workers (pre-merge).
 * See `gitnexus/src/storage/parse-cache.ts`.
 */
outRawResults?: ParseWorkerResult[], exportedTypeMap?: ExportedTypeMap) => Promise<WorkerExtractedData>;
