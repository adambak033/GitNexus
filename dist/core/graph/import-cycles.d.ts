/**
 * Elementary import-cycle enumeration.
 *
 * ## What is reported
 *
 * Every *elementary* cycle of the file-import graph — a closed walk that visits
 * no file twice — is reported exactly once. Self-imports (`a -> a`) and
 * two-file cycles count. Cycles that are nested inside, or that overlap with,
 * other cycles are each reported separately: a strongly connected component
 * with three mutually-importing files contributes five cycles, not one.
 *
 * This replaces an earlier implementation that returned ONE representative
 * cycle per cyclic strongly connected component. That made the reported count a
 * count of tangles, not of cycles, and it hid every cycle in a component but
 * the first — including cycles that a reader would have to break separately.
 * The tangle count is still available, as `componentCount`, under a name that
 * says what it is.
 *
 * The scale of what the old shape hid, measured on GitNexus itself (2,079
 * files, 5,320 initialization-forcing import edges): it reported 11 cycles.
 * There are 27,939, spread across those same 11 components. It showed 11 of
 * them and 27,928 were invisible.
 *
 * ## Algorithm
 *
 * Donald B. Johnson, "Finding all the elementary circuits of a directed graph",
 * SIAM J. Comput. 4(1), 1975 — SCC decomposition plus a backtracking search
 * guarded by the `blocked` flag and the `B` sets, which together guarantee that
 * no fruitless path is explored twice between two circuit outputs. That is what
 * buys the O((n + e)(c + 1)) bound for `c` circuits: the cost is proportional
 * to the answer, not to the size of the search space.
 *
 * SCCs come from an iterative Tarjan pass rather than the Kosaraju pass this
 * module used before. Johnson recomputes SCCs on each induced subgraph as the
 * root advances, and Tarjan needs only the forward adjacency, so nothing has to
 * rebuild a reverse graph once per root.
 *
 * ## How this differs from madge
 *
 * madge's `circular()` walks depth-first from every node carrying its ancestor
 * path and records `ancestors.slice(indexOf(dep))` whenever it reaches an
 * ancestor. It also marks nodes visited *globally* and skips them on later
 * walks, so once a node has been traversed, cycles reachable only by entering
 * it from a different predecessor are never seen. madge therefore reports many
 * cycles but not all of them, and which ones it misses depends on iteration
 * order. Johnson's is strictly stronger: it is complete.
 *
 * The practical consequence is that GitNexus reports MORE cycles than madge on
 * the same graph, and the two counts should not be expected to agree. Anyone
 * reconciling the two is not looking at a bug here.
 *
 * ## Determinism
 *
 * Adjacency lists and the node order are sorted (default string order, matching
 * `Array.prototype.sort`), the search visits neighbours in that order, and the
 * finished list is sorted element-wise. Same input, same output, byte for byte.
 *
 * ## Rotation normalization
 *
 * `[a, b, c, a]` and `[b, c, a, b]` are the same cycle and must be emitted
 * once. That is structural here rather than a post-hoc dedup pass: Johnson's
 * search for circuits rooted at `s` runs on the subgraph induced by the nodes
 * that sort at or after `s`, so every node of an emitted circuit sorts at or
 * after its root. Each cycle is therefore emitted exactly once, rooted at — and
 * closed back onto — its own lexicographically smallest node. No other rotation
 * of it can ever be produced.
 *
 * ## Bounds
 *
 * The number of elementary cycles is exponential in the worst case, so the
 * search is bounded twice: by the number of cycles (`IMPORT_CYCLE_LIMIT`) and
 * by the work spent finding them (`IMPORT_CYCLE_WORK_LIMIT`). The second is not
 * redundant — Johnson's is output-sensitive, so a graph that yields few cycles
 * per root can burn unbounded time while staying far under the cycle cap.
 *
 * Exceeding either bound abandons the enumeration. What a partial run had
 * accumulated is discarded rather than returned, because a partial list of
 * elementary cycles is indistinguishable from a complete one at the call site
 * and would be read as "these are all of them". What is returned instead is a
 * different KIND of list — one representative cycle per cyclic component, the
 * old pre-enumeration answer — under `enumeration: 'component-representatives'`
 * so the difference is machine-readable and not merely documented. Only a run
 * that dies inside the decomposition itself reports nothing at all.
 */
interface ImportEdge {
    source: string;
    target: string;
}
/**
 * Elementary cycles reported before the search fails closed.
 *
 * The binding constraint is response size, not time. THE MEASUREMENT THAT SETS
 * THIS NUMBER, on GitNexus itself — 2,079 files, 5,320 initialization-forcing
 * import edges: complete enumeration finds 27,939 elementary cycles across 11
 * components in 241ms. Fast. But those cycles average 13 files each, so
 * serializing them is 400,877 path entries — a 21.8 MB JSON response for a tool
 * whose result is read by an agent. Time was never going to stop that, and
 * neither was the work budget (the same run spends 6.3M of its 10M).
 *
 * Keep that measurement next to this constant. Without it the cap looks like an
 * arbitrary round number and gets raised or deleted by someone who has only
 * ever seen it not fire.
 *
 * So the cap is set where the answer stops being consumable rather than where
 * the machine stops coping. Past 10,000 cycles the ten-thousandth path tells a
 * reader nothing the first hundred did not, and what a reader acts on is
 * `componentCount` plus one cycle per component — which is exactly what a
 * report over the cap degrades to, rather than to nothing.
 */
export declare const IMPORT_CYCLE_LIMIT = 10000;
/**
 * Units of search effort allowed before the search fails closed — edges
 * examined, nodes scanned per root, and emitted cycle nodes at
 * `EMITTED_NODE_COST` each — counted across the SCC passes and the circuit
 * search alike.
 *
 * The cycle cap alone does NOT bound this. Johnson's is output-sensitive at
 * O((n + e)(c + 1)), so producing `c` cycles still scales with the graph: a
 * component of mutually-importing neighbours yields one or two cycles per root,
 * so an SCC pass runs per node and the total is quadratic while the cycle count
 * stays low. `check` admits import graphs up to 100k edges, so that shape is
 * reachable, and there it is minutes of work under a cycle cap that never
 * trips. The reverse gap is just as real: a single 50k-file component produces
 * cycles 50k files long, and 10k of those exhaust the heap. One bound cannot
 * see both, which is why there are two.
 *
 * Measured on this implementation against the mutual-import chain — the shape
 * that spends the whole budget, where every unit buys a fresh SCC pass over a
 * barely-smaller component — the rate is 2.9-5.2M units/second (5.2M at 10k
 * nodes, 2.9M at 50k; it falls as the component grows). So 10M buys roughly
 * 1.9-3.5s of enumeration on this hardware. That is the one shape where a user
 * waits, and it is the number to re-measure if this constant is ever moved.
 *
 * It sits far above what real import graphs cost: a 100k-file acyclic graph
 * spends 220k units, and 20k independent three-file tangles spend 576k. Only a
 * component both large and densely tangled reaches the cap, and that
 * component's honest answer is "too tangled to enumerate", not a
 * silently-shortened list.
 */
export declare const IMPORT_CYCLE_WORK_LIMIT = 10000000;
/** Which bound stopped the search. */
export type ImportCycleLimit = 'cycles' | 'work';
/**
 * The result of an enumeration.
 *
 * `enumeration` is the union's discriminant rather than a sibling flag,
 * deliberately: a caller cannot reach `cycles` without first narrowing on what
 * kind of list it is holding. A partial enumeration and a complete one are
 * indistinguishable by inspection — both are arrays of real cycles — so the
 * difference has to be carried in the type, not in a comment or a count that
 * happens to look small.
 */
export type ImportCycleReport = {
    readonly enumeration: 'complete';
    /**
     * Every elementary cycle, each as `[n0, n1, ..., nk, n0]` — the first
     * node repeated at the end so the closing edge is explicit. Sorted.
     */
    readonly cycles: readonly string[][];
    /**
     * Number of cyclic strongly connected components — the count of
     * independent tangles. This is what the previous implementation called
     * the cycle count; it is NOT the number of cycles.
     */
    readonly componentCount: number;
} | {
    /**
     * A bound was hit, so the enumeration is abandoned — but the SCC
     * decomposition had already finished, so every tangle is known and each
     * one gets a representative. This is strictly more useful than an error:
     * a CI job can act on "these 11 components are cyclic, here is one cycle
     * through each", and cannot act on nothing at all.
     *
     * What is NOT carried is any count of cycles. `componentCount` is exact;
     * the number of elementary cycles is unknown and stays unknown.
     */
    readonly enumeration: 'component-representatives';
    /** One cycle per component, same shape and ordering as the complete list. */
    readonly cycles: readonly string[][];
    readonly componentCount: number;
    readonly reason: ImportCycleLimit;
    readonly limit: number;
} | {
    /**
     * A bound was hit inside the decomposition itself, so not even the tangle
     * count is known. There is genuinely nothing to report.
     */
    readonly enumeration: 'none';
    readonly reason: ImportCycleLimit;
    readonly limit: number;
};
/**
 * Enumerate every elementary cycle in the file import graph.
 *
 * The result is discriminated on `enumeration`; see `ImportCycleReport` for
 * what each variant carries. Past either bound the enumeration is discarded
 * rather than truncated — see the module docblock for the algorithm, the
 * rotation rule, and why a partial cycle list is not a safe thing to return.
 */
export declare function findImportCycles(edges: readonly ImportEdge[], cycleLimit?: number, workLimit?: number): ImportCycleReport;
export {};
