/**
 * Process Detection Processor
 *
 * Detects execution flows (Processes) in the code graph by:
 * 1. Finding entry points (functions with no internal callers)
 * 2. Tracing forward via CALLS edges (DFS)
 * 3. Grouping and deduplicating similar paths
 * 4. Labeling with heuristic names
 *
 * Processes help agents understand how features work through the codebase.
 */
import { KnowledgeGraph } from '../graph/types.js';
import { CommunityMembership } from './community-processor.js';
export interface ProcessDetectionConfig {
    maxTraceDepth: number;
    maxBranching: number;
    maxProcesses: number;
    minSteps: number;
}
export interface ProcessNode {
    id: string;
    label: string;
    heuristicLabel: string;
    processType: 'intra_community' | 'cross_community';
    stepCount: number;
    communities: string[];
    entryPointId: string;
    terminalId: string;
    trace: string[];
}
export interface ProcessStep {
    nodeId: string;
    processId: string;
    step: number;
}
/**
 * What the detection ceilings dropped, so a partial answer cannot present
 * itself as a complete one.
 *
 * Every field here was previously either a `logger.debug` line or nothing at
 * all: the caps fired, the result came back looking whole, and no consumer
 * could tell. A silently truncating cap reads as "this is everything", which is
 * the same class of confident-empty answer the rest of this work is about.
 * `dispatchFanoutSkipped` / `propertyDispatch.skippedKeys` are the precedent.
 *
 * The counters are kept SEPARATE rather than summed because they mean different
 * things and a reader acts on them differently: unexplored entry points mean
 * whole flows are missing, while a depth-capped trace means a flow is present
 * but shorter than it really is. `truncated` is the single boolean to branch on.
 * That distinction is not decoration — `pipeline-phases/processes.ts` uses it to
 * decide which of these are worth a `warn` and which belong at `debug`.
 *
 * `entryPointCandidatesDropped` was MISSED on the first pass, which is worth
 * recording because the comment deriving `truncated` claimed "a new ceiling
 * added later cannot be forgotten here" while an EXISTING one already had been:
 * `findEntryPoints` ranks every scoring candidate and then keeps 200, so
 * `entryPointsUnexplored` — computed over the list it RETURNS — could only ever
 * see the survivors. On any repository with more than 200 candidate entry
 * points that slice is the dominant ceiling, and it was invisible.
 */
export interface ProcessTruncationStats {
    /** True when any ceiling below fired. */
    truncated: boolean;
    /**
     * Scoring candidates that never reached the trace loop because
     * `findEntryPoints` keeps only the top `ENTRY_POINT_CANDIDATE_LIMIT`.
     * Counted BEFORE the slice, so it sees what `entryPointsFound` cannot.
     */
    entryPointCandidatesDropped: number;
    /** Entry points never traced at all — the trace-collection loop stopped first. */
    entryPointsUnexplored: number;
    /** Entry-point walks abandoned with branches still on the stack. */
    walksCutByBudget: number;
    /** Traces that end at `maxTraceDepth`, i.e. are a PREFIX of a longer flow. */
    tracesDepthCapped: number;
    /** Callees never followed because a call site exceeded `maxBranching`. */
    calleesDropped: number;
    /** Deduplicated traces discarded because `maxProcesses` was already full. */
    processesDropped: number;
}
export interface ProcessDetectionResult {
    processes: ProcessNode[];
    steps: ProcessStep[];
    stats: {
        totalProcesses: number;
        crossCommunityCount: number;
        avgStepCount: number;
        entryPointsFound: number;
        /** Additive — existing consumers read the four counters above unchanged. */
        truncation: ProcessTruncationStats;
    };
}
/**
 * Detect processes (execution flows) in the knowledge graph
 *
 * This runs AFTER community detection, using CALLS edges to trace flows.
 */
export declare const processProcesses: (knowledgeGraph: KnowledgeGraph, memberships: CommunityMembership[], onProgress?: (message: string, progress: number) => void, config?: Partial<ProcessDetectionConfig>, 
/**
 * Places the program reaches outward — fetch calls and ORM queries, each with
 * a file and a line (R3-6). Attributed to their enclosing function to form the
 * sink set; omitted, behaviour is exactly as before.
 */
outwardActionSites?: readonly OutwardActionSite[]) => Promise<ProcessDetectionResult>;
type AdjacencyList = Map<string, string[]>;
/**
 * Trace forward from an entry point using DEPTH-first search.
 * Returns all distinct paths up to maxDepth.
 */
export declare const traceFromEntryPoint: (entryId: string, callsEdges: AdjacencyList, config: ProcessDetectionConfig, 
/**
 * Functions that reach outward (R3-6). A trace also ENDS here, even though
 * the walk continues past it: a flow whose meaningful endpoint calls onward
 * was otherwise never a candidate, only ever surviving as whatever leaf it
 * bottomed out in.
 */
isSink?: (nodeId: string) => boolean, 
/**
 * Mutated in place when a ceiling fires. Optional so the many direct callers
 * in tests are unchanged, and because a caller that does not care about
 * completeness should not have to invent a counter to ask for a trace.
 */
truncation?: ProcessTruncationStats) => string[][];
/** A place in the source where the program reaches outward. */
export interface OutwardActionSite {
    readonly filePath: string;
    readonly lineNumber: number;
}
/**
 * Functions that DO something outward — issue a request, run a query (R3-6).
 *
 * The missing layer behind "business flows are never processes". A trace is
 * only emitted at a node with NO outgoing calls, so a real flow — scan, score,
 * arm, place the order — is always a PREFIX of some longer chain that runs on
 * into date helpers and formatters, and can never be a process in its own
 * right. Ending a trace somewhere meaningful needs a notion of an endpoint that
 * is not a leaf, and the walk had none.
 *
 * GitNexus already knew where the program reaches outward: the parse phase
 * collects fetch calls and ORM queries carrying `filePath` + `lineNumber`. Those
 * facts only ever produced FILE-level edges (`File -[FETCHES]-> Route`), which
 * is too coarse to end a trace on — every function in a file containing one
 * would qualify. Attributing each site to the function whose range CONTAINS it
 * turns the same facts into the function-level signal the walk needs, with no
 * new extraction, no new relation pair, and no schema change.
 *
 * Innermost wins: a nested closure that performs the call is the sink, not the
 * outer function that merely spans it.
 */
export declare function buildSinkFunctionSet(graph: KnowledgeGraph, sites: readonly OutwardActionSite[]): ReadonlySet<string>;
/**
 * Merge traces that are subsets of other traces.
 * Keep longer traces, remove redundant shorter ones.
 */
export declare const deduplicateTraces: (traces: string[][], 
/** See `buildSinkFunctionSet` — a sink-terminated trace survives subsumption. */
isSink?: (nodeId: string) => boolean) => string[][];
export {};
