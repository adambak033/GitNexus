/**
 * Parse implementation — chunked parse + resolve loop.
 *
 * This is the core parsing engine of the ingestion pipeline. It reads
 * source files in byte-budget chunks (~20MB each), parses via the worker
 * pool (the sole parse path — there is no sequential fallback), and emits
 * route CALLS edges. Import,
 * call, and inheritance resolution are owned by the scope-resolution
 * phase, not here (RING4-1 #942 removed the legacy call DAG; RING4-2 #943
 * removed the legacy per-file import resolution + wildcard synthesis).
 *
 * Consumed by the parse phase (`parse.ts`) — the phase file handles
 * dependency wiring while the heavy implementation lives here.
 *
 * @module
 */
import { BindingAccumulator } from '../binding-accumulator.js';
import { type ExportedTypeMap } from '../call-processor.js';
import { type MutableSemanticModel } from '../model/index.js';
import { type PipelineProgress } from '../../../_shared/index.js';
import type { ExtractedDecoratorRoute, ExtractedFetchCall, ExtractedORMQuery, ExtractedRoute, ExtractedToolDef, FetchWrapperDef } from '../workers/parse-worker.js';
import type { KnowledgeGraph } from '../../graph/types.js';
import type { PipelineOptions } from '../pipeline.js';
/** Projected main-thread heap need for the parse phase (#2649). */
export declare function projectParseHeapNeedBytes(parseableFileCount: number): number;
/** True when the mid-loop heap guard should abort the parse (#2649). */
export declare function shouldAbortForHeapPressure(heapUsedBytes: number, heapLimitBytes: number): boolean;
/**
 * The ONE action a user should take when this repository doesn't fit the
 * current heap (#2649). Users hitting memory limits are already frustrated —
 * a menu of env knobs at that moment is noise. Branch on whether the machine
 * itself has more memory to give: if this process's limit sits well below
 * what the RAM-aware auto-sizer would grant (an inherited NODE_OPTIONS pin or
 * explicit flag), the fix is to drop the pin — gitnexus sizes itself.
 * Otherwise the machine is the ceiling and only scope or hardware helps.
 * Escape hatches (GITNEXUS_MEMORY etc.) stay in the README env table.
 */
export declare function heapPressureRemedy(heapLimitBytes: number): string;
type ScannedFile = {
    path: string;
    size: number;
};
type ProgressFn = (progress: PipelineProgress) => void;
/**
 * Whole-repo, cross-file route extraction (main thread).
 *
 * Some frameworks define their route table from a single root file that pulls
 * in other files across the repo — e.g. Django follows
 * `manage.py → DJANGO_SETTINGS_MODULE → ROOT_URLCONF → root urls.py`, then walks
 * `include()` chains across many files. Unlike single-file route files (Laravel
 * `routes/*.php`), which the parse worker extracts in isolation, these need a
 * whole-repo view and on-demand cross-file reads — neither of which the
 * filesystem-free worker can provide, and which a per-chunk worker view gets
 * wrong whenever the root file and its includes land in different chunks.
 *
 * So it runs here, once, after every file is scanned — mirroring the FastAPI
 * router-include join further below. The pass is language-agnostic: any
 * {@link LanguageProvider} exposing both `discoverRootRouteFile` and
 * `extractRoutes` participates (today only Python/Django). For repos without
 * such a framework the cost is a path scan plus one `manage.py`-style miss.
 */
export declare function extractCrossFileRoutes(allPaths: string[], repoPath: string): Promise<ExtractedRoute[]>;
/**
 * Chunked parse + resolve loop.
 *
 * Reads source in byte-budget chunks (~20MB each):
 * 1. Parse each chunk via the worker pool (the sole parse path)
 * 2. After all chunks parse, emit route CALLS edges (deferred so resolution
 *    sees the full repo graph) and collect the exported-type map
 * 3. Collect TypeEnv bindings for cross-file propagation
 *
 * Import, call, and inheritance edges are emitted by the scope-resolution
 * phase, not here (RING4-1 #942 / RING4-2 #943 removed the legacy passes).
 */
export declare function runChunkedParseAndResolve(graph: KnowledgeGraph, scannedFiles: ScannedFile[], allPaths: string[], totalFiles: number, repoPath: string, pipelineStart: number, onProgress: ProgressFn, options?: PipelineOptions): Promise<{
    exportedTypeMap: ExportedTypeMap;
    allFetchCalls: ExtractedFetchCall[];
    allFetchWrapperDefs: FetchWrapperDef[];
    allExtractedRoutes: ExtractedRoute[];
    allDecoratorRoutes: ExtractedDecoratorRoute[];
    allToolDefs: ExtractedToolDef[];
    allORMQueries: ExtractedORMQuery[];
    bindingAccumulator: BindingAccumulator;
    /** Route URL → resolved handler symbol UID (Part 2, #2138). Lets the routes
     *  phase stamp `handlerSymbolId` on Route nodes so contract extraction can
     *  read the handler from the graph instead of re-parsing source. */
    routeHandlerSymbols: ReadonlyMap<string, string>;
    /** SemanticModel populated during parse — scope-resolution reads its
     *  TypeRegistry / MethodRegistry / SymbolTable indexes. */
    model: MutableSemanticModel;
    /** Whether a worker pool was actually constructed for this run. False
     *  means no pool was needed: a warm all-cache-hit run replays cached
     *  worker output without spawning workers, or there were no parseable
     *  files. There is no sequential parser — the pool is the sole parse path
     *  whenever a chunk misses the cache. */
    usedWorkerPool: boolean;
    /** Worker-produced ParsedFile artifacts aggregated across chunks.
     *  Threaded into scope-resolution as a re-extract cache so the warm-
     *  cache analyze run can skip the dominant `extractParsedFile` cost
     *  (otherwise ~58s on a 1000-file repo). */
    parsedFiles: import('../../../_shared/index.js').ParsedFile[];
}>;
export {};
