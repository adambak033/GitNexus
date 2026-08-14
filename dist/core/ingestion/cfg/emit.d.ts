/**
 * cfg/emit.ts (issue #2081, M1) — serialized side-channel → graph.
 *
 * Pure helper: given a file's per-function CFGs (off `ParsedFile.cfgSideChannel`,
 * produced by the worker in U3), emit one persisted `BasicBlock` node per block
 * and one `CFG` edge per edge into the {@link KnowledgeGraph}. Invoked from
 * scope-resolution (run.ts Phase 4) while the disk-backed ParsedFile store is
 * still live — the only window where the worker-built CFGs are loaded (KTD1/
 * KTD5). Default (`--pdg` off) runs never call this, so the emitted graph stays
 * byte-identical to a pre-#2081 run.
 *
 * BasicBlock id: `BasicBlock:<filePath>:<functionStartLine>:<functionStartColumn>:<blockIndex>`
 * (KTD3). The function start line+column segments disambiguate blocks across
 * multiple functions in one file — including same-line functions — since each
 * function's block indices restart at 0; blocks carry no `name` (the
 * BasicBlock table has no such column). The edge KIND
 * (`seq`/`cond-true`/…) rides in the relationship `reason` — CFG edges are
 * values of the single `CodeRelation` table's `type` column (`'CFG'`), so the
 * kind cannot be its own edge type and is queried via `reason`.
 */
import type { KnowledgeGraph } from '../../graph/types.js';
import { type ReachingDefsSolver } from './reaching-defs.js';
import type { BasicBlockData, BindingEntry, FunctionCfg } from './types.js';
/**
 * Cell-format constants live in the LEAF module `callee-cell-format.ts` and are
 * re-exported here so every existing importer keeps working. The consumer side
 * (`mcp/local/pdg-impact.ts`) imports them from the leaf directly: importing any
 * binding from THIS module evaluates it, and with it the whole analyze-only CFG
 * closure — 8 modules on every MCP server start to read two strings (#2802
 * review). Producer and consumer still resolve to one definition, so the drift
 * these shared constants exist to prevent stays impossible.
 */
export { CALLEES_TRUNCATED_SENTINEL, CALLEE_ID_SEP } from './callee-cell-format.js';
/**
 * Default per-function CFG edge cap. A pathological generated function could
 * otherwise emit an unbounded edge set; the cap bounds graph growth and is
 * overridable via `--pdg` options. `0` (in options) means no cap (unlimited
 * — see the `cap` mapping in {@link emitFileCfgs}); `undefined` means this
 * default.
 */
export declare const DEFAULT_MAX_CFG_EDGES_PER_FUNCTION = 5000;
/**
 * Default per-function REACHING_DEF edge cap (#2082 M2 KTD9). 4000 mirrors
 * Joern's per-method `maxNumberOfDefinitions` — the closest production prior
 * art — but truncates-and-warns instead of silently skipping the function.
 * Counts (defBlock, useBlock, binding) DEDUPED edges, not statement-level
 * facts. `0` ⇒ unlimited; `undefined` ⇒ this default.
 */
export declare const DEFAULT_PDG_MAX_REACHING_DEF_EDGES_PER_FUNCTION = 4000;
/**
 * Default per-function CDG edge cap (#2085 M5). CDG edge count is bounded by
 * (blocks × control-nesting-depth) — comparable to the CFG edge count — so it
 * reuses the CFG default of 5000. Counts DEDUPED (controller, dependent, label)
 * edges (the pure {@link computeControlDependence} already dedups). `0` ⇒
 * unlimited; `undefined` ⇒ this default. Folded into the `RepoMeta.pdg` stamp
 * (U5) so introducing CDG forces a full writeback for pre-CDG `--pdg` indexes.
 */
export declare const DEFAULT_PDG_MAX_CDG_EDGES_PER_FUNCTION = 5000;
/**
 * Heap-safety ceiling on {@link computeControlDependence}'s pre-dedup
 * materialization (#2188 review). The walk is O(edges × post-dom depth), and its
 * `out` IS the deduped-edge quantity the per-function cap trims — so, UNLIKE
 * REACHING_DEF's facts ceiling, this is deliberately NOT derived from the
 * runtime edge cap (doing so would pre-truncate the very set the cap reports on,
 * losing the exact dropped count). A fixed, generous multiple of the default
 * edge cap: far above any real function — a catastrophe backstop only. When hit,
 * the per-function cap reporting plus the `truncated` flag keep it observable
 * (never a silent drop).
 */
export declare const DEFAULT_PDG_MAX_CDG_MATERIALIZATION_PER_FUNCTION: number;
/**
 * Env flag that additionally emits diagnostic `POST_DOMINATE` edges
 * (block → its immediate post-dominator) alongside CDG (#2085 M5 KTD8). Off in
 * every normal `--pdg` run — these are for inspecting the post-dom tree, not a
 * queryable product surface. Accepts `1`/`true` (case-insensitive).
 */
export declare const POST_DOMINATE_DEBUG_ENV = "GITNEXUS_PDG_EMIT_POST_DOMINATE";
/**
 * Fact-materialization headroom over the edge cap (#2082 M2 U3/F3): facts are
 * O(defs×uses) BY SPEC in merge-heavy code, and the edge cap alone bounds the
 * GRAPH, not the per-function memory spike of materializing facts before
 * dedup. {@link emitFileReachingDefs} hands `edgeCap × this` to
 * `computeReachingDefs` as `maxFacts` (unlimited when the edge cap is 0) —
 * single source of truth; the DEFAULT constant below is derived, never the
 * mechanism.
 */
export declare const REACHING_DEF_FACTS_PER_EDGE_CAP = 4;
/** Derived emit-path fact limit at the default edge cap (bench/doc anchor). */
export declare const DEFAULT_PDG_MAX_REACHING_DEF_FACTS_PER_FUNCTION: number;
/**
 * Fixpoint-iteration budget for {@link computeReachingDefs}, as a multiple of
 * the function's block count ({@link emitFileReachingDefs} passes
 * `blocks.length × this` as `maxBlockVisits`). Iterative reaching-defs on a
 * reducible CFG converges in O(loop-nesting-depth) passes, so a worklist
 * re-visits each block a small multiple of times for real code; this budget
 * tolerates a nesting depth far beyond any hand-written function (real code is
 * ≤ ~15 deep) while truncating the pathological deep nest that otherwise drives
 * the solver to O(blocks²) — measured at seconds + GB on a machine-generated
 * 2000-line all-loops function whose fact count stays linear (so `maxFacts`
 * never fires). Truncation degrades to a sound empty REACHING_DEF for that one
 * function (status `truncated`), never wrong facts.
 *
 * As of #2201 this ceiling is an adversarial-only backstop that effectively
 * never fires on real code: the production solver auto-selects the SSA-sparse
 * path for the looping functions that would breach it, and the SSA path has no
 * fixpoint iteration (it answers reaching queries from the def-use graph in one
 * pass) so it computes the full facts where the dense worklist would have
 * truncated. The budget is still consulted on the dense fallback path (small /
 * loop-free functions, and throw-edge / unreachable-block functions the SSA path
 * does not model). WTO / loop-aware iteration ordering was benchmarked and
 * rejected (0% faster — the cost was dense-set propagation, not visitation
 * order); SSA-sparse was the real fix. See reaching-defs.ts.
 */
export declare const DEFAULT_PDG_MAX_REACHING_DEF_BLOCK_REVISITS = 64;
export interface CfgEmitResult {
    blocks: number;
    edges: number;
    /** Edges dropped because a function's edge count exceeded the cap. */
    droppedEdges: number;
    /** Number of functions that hit the cap. */
    cappedFunctions: number;
}
/**
 * The single BasicBlock id template (module doc). Exported for the M3 taint
 * emit path (taint/emit.ts), whose TAINTED/SANITIZES edges must address the
 * SAME persisted block nodes — a re-derived copy of this template would
 * silently dangle the moment either drifted.
 */
export declare const basicBlockId: (filePath: string, functionStartLine: number, functionStartColumn: number, blockIndex: number) => string;
/**
 * Whether an untrusted `cfgSideChannel` element is safe to feed to
 * {@link emitFileCfgs}. Deliberately NOT full FunctionCfg validation — it
 * checks exactly the fields whose corruption is SILENT given emit's
 * mechanics: {@link basicBlockId} string-templates every id-anchor value
 * (filePath, function start line/column, block index, edge endpoints) and
 * the graph's addNode/addRelationship are no-throw Map inserts. Unchecked,
 * a missing anchor field cross-wires same-`undefined`-id blocks across
 * functions (addNode is first-writer-wins), and an edge endpoint that
 * matches no block index becomes a dangling `BasicBlock:…:<n>` edge that
 * detonates much later at DB bulk-load instead of throwing here — so
 * endpoints are checked for MEMBERSHIP in the block-index set, not just
 * integer-ness. Lives in this module so the guard evolves with the id
 * templating it defends (#2099 F4; M2 fields that join the id path must
 * join this check).
 */
export declare const isEmitSafeCfg: (cfg: FunctionCfg | undefined | null) => cfg is FunctionCfg;
/**
 * Whether a structurally-valid CFG's M2 statement facts are safe to feed to
 * the reaching-defs solver + REACHING_DEF id templating (#2082 U1/U4): the
 * binding table's name/declLine/declColumn template into edge ids, and
 * statement def/use indices must stay IN RANGE of the table (an escaping
 * index would fabricate `undefined`-keyed ids). Deliberately SEPARATE from
 * {@link isEmitSafeCfg}: malformed facts must cost only the function's
 * REACHING_DEF projection — degrading to M1 behavior (CFG emitted, no facts)
 * — never the BasicBlock/CFG layer itself.
 */
export declare const hasEmitSafeFacts: (cfg: FunctionCfg) => boolean;
/**
 * Emit BasicBlock nodes + CFG edges for every function CFG in `cfgs`.
 *
 * `maxEdgesPerFunction` caps edges per function. On overflow we stop emitting
 * that function's remaining edges and call `onWarn` naming the dropped count —
 * no silent truncation (KTD6/R6). Block nodes are always fully emitted (their
 * count is bounded by the function's statement count); only edges are capped.
 */
/**
 * Space-joined, sorted, de-duplicated leaf callee names invoked directly in a
 * block (`call`/`new` sites; the leaf of a dotted path — `child_process.exec` ⇒
 * `exec`). This is the persisted substrate for statement-precise inter-procedural
 * impact: a callee reached from a function is "proven" to be impacted by a
 * changed statement iff its name appears in the callees of a block in that
 * statement's dependence slice. `sites` is harvested only for TS/JS under `--pdg`
 * (and absent on synthetic ENTRY/EXIT), so the field is empty elsewhere and the
 * bridge degrades to the prior (callgraph-equal) behavior. Space-joined because
 * leaf names are identifiers (no spaces) and the field is itself one CSV cell.
 */
export declare function calleesOfBlock(block: BasicBlockData): string;
/**
 * Tab-joined ({@link CALLEE_ID_SEP}), sorted, de-duplicated RESOLVED callee symbol ids invoked
 * directly in a block — the SOUND parallel to {@link calleesOfBlock}'s leaf
 * names (#2227 follow-up plan U3, KTD1/KTD2/KTD7). Each block site's call-site
 * anchor `at` (U1) is joined by EXACT position to the per-file resolved-id map
 * `fileMap` (U2's `(line,col) → Set<calleeId>`), so a callee reached from a
 * function is proven impacted by a changed statement iff its resolved id — not
 * just its leaf NAME — appears in a slice block's `calleeIds`. This eliminates
 * the same-leaf-name collision (false-proven) and import-alias (false-unproven)
 * the name predicate suffers on overloading languages.
 *
 * The site partitioning is inherited verbatim from {@link calleesOfBlock}: the
 * SAME `member-read`-skip and the SAME per-statement site cap (R7) — a capped
 * statement adds {@link CALLEES_TRUNCATED_SENTINEL} so the bridge keeps the
 * block callee-unknown for ids too (callgraph-equal rather than under-proving).
 * Because `at` is the SAME anchor the CALLS resolution keyed `atRange` on
 * (KTD7), the join lands on exactly the sites the name harvest partitioned,
 * including the nested-function exclusion (so a single-line inline closure's
 * inner call never leaks its id into the outer block).
 *
 * `fileMap` is the resolved-id map for THIS file (`calleeIdAccumulator.get(
 * filePath)` in run.ts). Absent (pdg off, or a file with no captured CALLS) ⇒
 * `''` — the bridge then degrades to the leaf-name fallback (R3). A site whose
 * `at` is absent (pre-U1 channel) or whose position is not in the map
 * contributes no id (graceful, never throws).
 */
export declare function calleeIdsOfBlock(block: BasicBlockData, fileMap: ReadonlyMap<string, ReadonlySet<string>> | undefined): string;
export declare function emitFileCfgs(graph: KnowledgeGraph, cfgs: readonly FunctionCfg[], maxEdgesPerFunction?: number, onWarn?: (message: string) => void, calleeIdMap?: ReadonlyMap<string, ReadonlySet<string>>): CfgEmitResult;
export interface ReachingDefEmitResult {
    /** Deduped (defBlock, useBlock, binding) edges persisted. */
    edges: number;
    /** Deduped edges dropped by the per-function edge cap. */
    droppedEdges: number;
    cappedFunctions: number;
    /** Functions whose FACT materialization hit the solver's maxFacts limit. */
    truncatedFunctions: number;
    /** Functions whose facts failed {@link hasEmitSafeFacts} (CFG kept, facts skipped). */
    malformedFactFunctions: number;
    /** Total statement-level facts the solver produced (pre-dedup telemetry). */
    facts: number;
}
/**
 * Stable identity for a binding inside edge ids (#2082 M2 KTD3/KTD9):
 * `name:declLine:declCol` for declared bindings, `name@module` for synthetic
 * ones. Distinct same-name bindings never share a key; identifier characters
 * cannot contain the id separators. Exported for the M3 taint emit path —
 * TAINTED/SANITIZES ids key bindings with the same discipline.
 */
export declare const bindingKey: (b: BindingEntry) => string;
/**
 * Compute reaching definitions per function and persist the bounded
 * REACHING_DEF projection (#2082 M2 U4).
 *
 * Facts are DEDUPED to (defBlock, useBlock, binding) before budgeting — the
 * persisted columns (`from,to,type,confidence,reason,step`; relationship ids
 * are in-memory-only, the CodeRelation table has no id column) cannot
 * distinguish finer rows, so statement-indexed ids would only manufacture
 * byte-identical duplicate rows that burn budget. Statement granularity lives
 * in the in-memory {@link computeReachingDefs} result, which the M3 taint
 * engine recomputes on demand — the budget here governs only this projection
 * and can never drop a taint fact.
 *
 * R7 (no silent truncation) covers BOTH layers: the per-function edge cap AND
 * the solver's fact-materialization limit (which can fire without the edge
 * cap ever being reached, since dedup is many-to-one) each produce one
 * unconditional `onWarn`. The edge-cap warn names the top bindings by fact
 * count — overflow is almost always one variable, which is exactly the datum
 * M3 tuning wants.
 */
export declare function emitFileReachingDefs(graph: KnowledgeGraph, cfgs: readonly FunctionCfg[], maxEdgesPerFunction?: number, onWarn?: (message: string) => void, solve?: ReachingDefsSolver): ReachingDefEmitResult;
export interface CdgEmitResult {
    /** Deduped (controller, dependent, label) CDG edges persisted. */
    edges: number;
    /** CDG edges dropped by the per-function edge cap. */
    droppedEdges: number;
    /** Functions that hit the CDG edge cap. */
    cappedFunctions: number;
    /** Diagnostic POST_DOMINATE edges emitted (0 unless the debug env is set). */
    postDominateEdges: number;
    /**
     * Functions skipped because EXIT was not reachable from every entry-reachable
     * block — post-dominance would be unsound (#2188 review). CFG/REACHING_DEF for
     * those functions are kept; only their CDG projection is omitted.
     */
    skippedUnsoundFunctions: number;
}
/**
 * Compute control dependence per function and persist the bounded CDG
 * projection (#2085 M5 U4). Mirrors {@link emitFileReachingDefs}: the pure
 * {@link computeControlDependence} already dedups to (controller, dependent,
 * label), so the per-function cap applies to deduped edges and overflow logs
 * one unconditional `onWarn` naming the dropped count — no silent truncation
 * (R6/R7). The branch label ('T'|'F') rides the `reason` column (KTD3),
 * mirroring how CFG stores its edge kind.
 *
 * When {@link POST_DOMINATE_DEBUG_ENV} is set, also emits diagnostic
 * `POST_DOMINATE` edges (block → its immediate post-dominator). These are NOT
 * capped or counted against the CDG budget — they exist only for inspecting the
 * post-dom tree and never appear in a normal run.
 */
export declare function emitFileCdg(graph: KnowledgeGraph, cfgs: readonly FunctionCfg[], maxEdgesPerFunction?: number, onWarn?: (message: string) => void): CdgEmitResult;
