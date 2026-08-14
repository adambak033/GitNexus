/**
 * `runScopeResolution` — generic registry-primary resolution
 * orchestrator.
 *
 *     ParsedFile[]  (one per file via `extractParsedFile`)
 *        │  finalizeScopeModel(  + provider hooks adapted to FinalizeHooks)
 *        ▼
 *     ScopeResolutionIndexes
 *        │  resolveReferenceSites
 *        ▼
 *     ReferenceIndex
 *        │  emitReceiverBoundCalls (FIRST — see Contract Invariant I1)
 *        │  emitFreeCallFallback   (THEN)
 *        │  emitReferencesViaLookup (LAST — uses handledSites)
 *        │  emitImportEdges
 *        ▼
 *     KnowledgeGraph
 *
 * Per-language entry points (e.g. `runPythonScopeResolution` in
 * `languages/python/scope-resolver.ts`) construct an `ScopeResolver` and
 * delegate here.
 *
 * Plan: `docs/plans/2026-04-20-001-refactor-emit-pipeline-generalization-plan.md`.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { MutableSemanticModel } from '../../model/semantic-model.js';
import { type ResolveStats } from '../../resolve-references.js';
import { buildGraphNodeLookup } from '../graph-bridge/node-lookup.js';
import { type FunctionNodeIndex } from '../../taint/summary-harvest-driver.js';
import type { FunctionSummary } from '../../taint/summary-model.js';
import type { CallSummary } from '../../taint/call-summary-model.js';
import { type PropertyNameIndex } from '../passes/unique-name-properties.js';
import type { ScopeResolver, UndecidedSatisfaction } from '../contract/scope-resolver.js';
import type { ResolutionOutcome, ResolutionOutcomeRecorder } from '../resolution-outcome.js';
export type ScopeResolutionSubPhase = 'extracting' | 'analyzing types' | 'resolving references' | 'linking symbols';
interface RunScopeResolutionInput {
    readonly graph: KnowledgeGraph;
    /**
     * Semantic model populated by the legacy `parse` phase. Scope-
     * resolution consumes its `TypeRegistry` / `MethodRegistry` /
     * `SymbolTable` lookups instead of rebuilding parallel indexes from
     * `ParsedFile[]`. See ARCHITECTURE.md § "Semantic-model source of
     * truth". Tests that invoke `runScopeResolution` in isolation pass a
     * freshly-created `MutableSemanticModel` populated from the same
     * `ParsedFile[]` to mirror the pipeline shape.
     */
    readonly model: MutableSemanticModel;
    readonly files: readonly {
        readonly path: string;
        readonly content: string;
    }[];
    readonly onWarn?: (message: string) => void;
    /**
     * Optional pre-parsed-Tree lookup keyed by file path: a cache hit lets the
     * per-file extract step skip a second `tree-sitter parser.parse(...)` call.
     * Currently always empty — the only producer was the (removed) sequential
     * parser, and workers can't return native Trees across the MessageChannel,
     * so the parse phase no longer threads one. Kept as an extension point;
     * cache miss is safe (the provider re-parses).
     */
    readonly treeCache?: {
        get(filePath: string): unknown;
    };
    /**
     * CFG/PDG opt-in (#2081 M1). When true, emit BasicBlock nodes + CFG edges
     * from each ParsedFile's worker-built `cfgSideChannel` during Phase-4 graph
     * emission (while the disk store is still live). Default/false ⇒ no CFG
     * nodes or edges and a byte-identical graph.
     */
    readonly pdg?: boolean;
    /** Per-function CFG edge cap. `undefined` ⇒ {@link DEFAULT_MAX_CFG_EDGES_PER_FUNCTION};
     *  `0` ⇒ no cap (unlimited). */
    readonly pdgMaxEdgesPerFunction?: number;
    /** Per-function REACHING_DEF edge cap (#2082 M2). `undefined` ⇒
     *  {@link DEFAULT_PDG_MAX_REACHING_DEF_EDGES_PER_FUNCTION}; `0` ⇒ no cap. */
    readonly pdgMaxReachingDefEdgesPerFunction?: number;
    /** Per-function CDG (control-dependence) edge cap (#2085 M5). `undefined` ⇒
     *  {@link DEFAULT_PDG_MAX_CDG_EDGES_PER_FUNCTION}; `0` ⇒ no cap. */
    readonly pdgMaxCdgEdgesPerFunction?: number;
    /** Per-function taint findings cap (#2083 M3, consumed by the U4 taint
     *  emit step in the pdg window). `undefined` ⇒
     *  `DEFAULT_PDG_MAX_TAINT_FINDINGS_PER_FUNCTION` (200); `0` ⇒ no cap. */
    readonly pdgMaxTaintFindingsPerFunction?: number;
    /** Per-finding taint hop cap (#2083 M3 KTD6 — bounds the hop-encoded
     *  `reason`; consumed by the U4 taint emit step). `undefined` ⇒
     *  `DEFAULT_PDG_MAX_TAINT_HOPS` (32); `0` ⇒ no cap. */
    readonly pdgMaxTaintHops?: number;
    /**
     * Streaming PDG-emit sink (#2202). When present (streaming on, full rebuild),
     * the `--pdg` emit routes BasicBlock nodes + intra-file PDG edges to THIS
     * graph-shaped target instead of the in-memory `graph`, so the bulky PDG
     * layer never accumulates in memory (peak RSS O(chunk)). Typed as a plain
     * `KnowledgeGraph` so this module stays decoupled from the persistence layer;
     * the caller (the scope-resolution phase) owns its lifecycle and finalizes it
     * after the last language. Absent ⇒ the emit writes to `graph` as before
     * (byte-identical default).
     */
    readonly pdgEmitSink?: KnowledgeGraph;
    /**
     * Cross-pass per-file dedup set for streaming PDG emit (#2202). Shared across
     * every language pass (owned by the scope-resolution phase). A file imported
     * by more than one language (e.g. a `.ts` module pulled into the Vue context
     * pass) is PDG-emitted in each pass over the same `cfgSideChannel`, producing
     * identical ids; the in-memory graph dedups that by id, but the streaming sink
     * is dedup-free (to stay O(write buffer), not O(total ids)). So when present
     * (streaming on), the emit loop skips a file whose PDG already streamed and
     * records the rest — keeping the streamed set byte-identical to the
     * Map-deduped whole-graph emit, for any language-pass order. Absent ⇒ no skip
     * (the graph Map dedups), so the default path is unchanged.
     */
    readonly pdgEmittedFiles?: Set<string>;
    /**
     * Optional graph-node lookup built ONCE by the caller and shared across
     * every language pass. `buildGraphNodeLookup` scans the whole graph and is
     * language-agnostic, so rebuilding it per language wastes both CPU and ~GBs
     * of heap (on the kernel it is ~2 GB; a 5-file language would otherwise build
     * its own full copy that then overlaps the next language's). When omitted
     * (tests / isolated calls) the lookup is built locally as before. Providers
     * that add graph nodes mid-pass (e.g. Ruby heritage Property nodes) still
     * rebuild a fresh post-heritage lookup internally, so sharing the pre-loop
     * base is safe.
     */
    readonly prebuiltNodeLookup?: ReturnType<typeof buildGraphNodeLookup>;
    /**
     * Functionish-node index built ONCE by the caller and shared across every
     * language pass (#2084 review P2-6). Like `prebuiltNodeLookup`,
     * `buildFunctionNodeIndex` is a whole-graph scan and is language-agnostic, so
     * rebuilding it per language wastes a full scan each time. When omitted
     * (tests / isolated calls) it is built locally for the pdg-enabled language.
     */
    readonly prebuiltFunctionNodeIndex?: FunctionNodeIndex;
    /**
     * `Property`-by-name index built ONCE by the caller and shared across every
     * language pass. Like the two above it is a whole-graph scan and is
     * language-agnostic; the per-language restriction is applied at lookup time
     * against that language's own file set, so sharing the index does not widen
     * what any single language can resolve to. Built locally when omitted.
     */
    readonly prebuiltPropertyNameIndex?: PropertyNameIndex;
    /**
     * Opaque per-language import-resolution config (e.g. tsconfig path
     * aliases for TypeScript). Loaded once by the caller via
     * `provider.loadResolutionConfig(repoPath)` and threaded into every
     * `provider.resolveImportTarget` call. `undefined` when the
     * provider doesn't supply a config loader.
     */
    readonly resolutionConfig?: unknown;
    /**
     * Pre-extracted ParsedFile artifacts keyed by file path. When a
     * file is present here, the extract loop reuses it directly and
     * skips `extractParsedFile` (which would re-parse the file with
     * tree-sitter on the main thread). Only files matching the
     * provider's language are honored — the loop verifies this
     * implicitly by language filter at the call-site (scopeResolution
     * phase).
     *
     * Worker-mode parses produce these ParsedFile artifacts as a side
     * effect of `extractParsedFile` running inside the worker; threading
     * them here is what lets the warm-cache analyze run skip the ~58s
     * scope-resolution re-parse loop on a multi-thousand-file repo.
     * Cache miss is safe — falls back to fresh extract.
     */
    readonly preExtractedParsedFiles?: ReadonlyMap<string, ParsedFile>;
    /**
     * Out-of-core scope index (disk-backed scope seal). When set AND `GITNEXUS_DISK_SCOPE_INDEX` is
     * enabled, the per-language `scopeTree` is sealed to a disk-backed store at
     * this path after resolve (before emit), and the heavy `Scope.bindings`
     * payload is dropped from heap — lowering the per-language peak (kernel:
     * ~20→~12 GB) so the analysis fits on smaller-RAM machines. Same storage path
     * as the ParsedFile store; a sibling `scope-index-store/` dir.
     */
    readonly scopeIndexStorePath?: string;
    /**
     * Optional additive diagnostics sink. Resolver passes call this when they
     * intentionally suppress an edge; the graph remains unchanged.
     */
    readonly recordResolutionOutcome?: ResolutionOutcomeRecorder;
    /**
     * Optional progress callback for UI updates during long-running scope
     * resolution. Called periodically during the extract loop and at each
     * sub-phase boundary (finalize, resolve, emit).
     *
     * @param subPhase  Current sub-phase name for display
     * @param current   Files processed so far (during extract) or total files (at phase boundaries)
     * @param total     Total files in this language
     */
    readonly onProgress?: (subPhase: ScopeResolutionSubPhase, current: number, total: number) => void;
}
interface RunScopeResolutionStats {
    readonly filesProcessed: number;
    readonly filesSkipped: number;
    readonly importsEmitted: number;
    readonly resolve: ResolveStats;
    readonly referenceEdgesEmitted: number;
    readonly referenceSkipped: number;
    /**
     * Property-dispatch keys dropped for exceeding the fan-out cap. Non-zero
     * means member calls through those keys got NO synthesized CALLS — the
     * #2437 false-safe gap for exactly those keys (names are in the warn log).
     */
    readonly propertyDispatchSkippedKeys: number;
    /** Cross-file value references resolved through finalized import bindings. */
    readonly importedValueRefEdges: number;
    /**
     * ACCESSES edges recovered by property NAME (A1/A5) — the last-resort pass
     * for receivers no precise pass could type.
     */
    readonly uniqueNamePropertyEdges: number;
    /**
     * Read/write sites left unresolved because two or more `Property` defs share
     * the name, so a unique-name match would have been a coin flip. This is the
     * population a receiver-typing improvement would convert into precise edges.
     */
    readonly uniqueNamePropertyAmbiguous: number;
    /**
     * Of `uniqueNamePropertyEdges`, how many the name carried several definitions
     * for and same-file or direct-import evidence narrowed to one. Strict
     * workspace uniqueness refused every one of these (R2).
     */
    readonly uniqueNamePropertyNarrowed: number;
    /**
     * The distinct field names behind `uniqueNamePropertyAmbiguous`, capped. A
     * count says a coverage gap exists; the names say WHICH fields are
     * unanswerable, so the gap is actionable rather than merely measured.
     */
    readonly uniqueNamePropertyAmbiguousNames: readonly string[];
    /**
     * Read/write sites whose name IS defined in the workspace but only in another
     * LANGUAGE, so per-language inference declined. Separate from
     * `uniqueNamePropertyAmbiguous` because the remedy differs: ambiguity wants
     * better receiver typing, this wants an anchor in the reading language (R3-1).
     */
    readonly uniqueNamePropertyCrossLanguage: number;
    /** Those names with the languages their definitions actually live in. */
    readonly uniqueNamePropertyCrossLanguageNames: readonly {
        readonly name: string;
        readonly languages: string[];
    }[];
    readonly resolutionOutcomes: readonly ResolutionOutcome[];
    /**
     * Interfaces whose structural-satisfaction check could not be completed for
     * at least one candidate type (#2873). NOT the same as "no implementors" —
     * these are questions the analyzer could not answer, and they are reported so
     * `impact` can hedge a zero instead of asserting one. Empty for every
     * language whose resolver has no `detectInterfaceImplementations` hook.
     */
    readonly undecidedSatisfaction: readonly UndecidedSatisfaction[];
    /**
     * Per-function taint summaries harvested in the pdg window (#2084 M4 U1).
     * Empty unless `input.pdg === true` and the language has a registered taint
     * model. Keyed by resolved `Function`/`Method` node id; the cross-function
     * fixpoint phase composes them over the complete `CALLS` graph.
     */
    readonly functionSummaries: readonly FunctionSummary[];
    /**
     * Per-function RETURN-VALUE ASCENT summaries harvested in the pdg window
     * (PDG FU-C, U-C2). Empty unless `input.pdg === true`. Keyed by resolved
     * `Function`/`Method`/`Constructor` node id; the whole-program CALL_SUMMARY
     * emit phase materialises one self-loop edge per entry once the call graph is
     * known. Unlike {@link functionSummaries} this needs NO taint model — it is
     * pure data-dependence — so it is harvested for every `--pdg` language.
     */
    readonly callSummaries: readonly CallSummary[];
}
export declare function runScopeResolution(input: RunScopeResolutionInput, provider: ScopeResolver): RunScopeResolutionStats;
export {};
