/**
 * Phase: scopeResolution
 *
 * Generic registry-primary resolution phase (RFC #909 Ring 3).
 *
 * For every language whose provider is registered in `SCOPE_RESOLVERS`:
 *   1. Filter scanned files by language extension.
 *   2. Read file contents.
 *   3. Drive the scope-based pipeline end-to-end via the generic
 *      `runScopeResolution(input, provider)` orchestrator.
 *   4. Emit IMPORTS / CALLS / ACCESSES / INHERITS / USES edges.
 *
 * This is the sole resolution path — RING4-1 (#942) deleted the legacy
 * call-resolution DAG, so there is no longer a per-language flag gating
 * registry-vs-legacy.
 *
 * Adding a language is one change: implement `ScopeResolver` in
 * `languages/<lang>/scope-resolver.ts` and register it in
 * `scope-resolution/pipeline/registry.ts`.
 *
 * @deps    parse  (needs Symbol nodes already in the graph so emit-references
 *                  can attach edges to existing Function/Method/Class nodes)
 * @reads   scannedFiles
 * @writes  graph (IMPORTS, CALLS, ACCESSES, INHERITS, USES)
 */
import type { PipelinePhase } from '../../pipeline-phases/types.js';
import { SupportedLanguages } from '../../../../_shared/index.js';
import type { ResolutionOutcome } from '../resolution-outcome.js';
import type { UndecidedSatisfaction } from '../contract/scope-resolver.js';
import type { FunctionSummary } from '../../taint/summary-model.js';
import type { CallSummary } from '../../taint/call-summary-model.js';
import { type PdgEmitManifest } from '../../../lbug/pdg-emit-sink.js';
import type { ScopeResolver } from '../contract/scope-resolver.js';
export interface ScopeResolutionOutput {
    /** True when at least one language ran. */
    readonly ran: boolean;
    /** Files seen across all languages. `0` when `ran === false`. */
    readonly filesProcessed: number;
    /** IMPORTS edges emitted across all languages. */
    readonly importsEmitted: number;
    /** Reference (CALLS / ACCESSES / INHERITS / USES) edges emitted. */
    readonly referenceEdgesEmitted: number;
    /** Additive stream of resolver diagnostics; does not affect graph edges. */
    readonly resolutionOutcomes: readonly ResolutionOutcome[];
    /**
     * Interfaces whose structural-satisfaction check could not be completed
     * (#2873). Emits no edges — it is what lets a query distinguish "nothing
     * implements this" from "we could not tell what implements this".
     *
     * Absent when no language ran; `[]` when one ran and decided everything.
     */
    readonly undecidedSatisfaction?: readonly UndecidedSatisfaction[];
    /**
     * Property inference facts a CALLER needs in order to read an empty result
     * correctly (R3-1). Without these, "no ACCESSES for this field" is
     * byte-identical whether the field is unused, ambiguous, or anchored in a
     * language this pass may not infer across — three different situations with
     * three different remedies.
     */
    readonly propertyInference: {
        /** Sites declined because the name could not be narrowed to one definition. */
        readonly ambiguous: number;
        /** Those field names, capped. */
        readonly ambiguousNames: readonly string[];
        /** Sites declined because every definition of the name is another language. */
        readonly crossLanguage: number;
        /** Those field names with the languages their definitions live in, capped. */
        readonly crossLanguageNames: readonly {
            readonly name: string;
            readonly languages: string[];
        }[];
    };
    /** Per-language breakdown for telemetry. */
    readonly perLanguage: ReadonlyMap<SupportedLanguages, {
        readonly filesProcessed: number;
        readonly importsEmitted: number;
        readonly referenceEdgesEmitted: number;
    }>;
    /**
     * Per-function taint summaries harvested in the pdg window (#2084 M4 U1),
     * across all languages. Empty unless `--pdg` and a registered taint model.
     * The `taintSummaries` phase composes these over the `CALLS` graph.
     */
    readonly functionSummaries: readonly FunctionSummary[];
    /**
     * Per-function RETURN-VALUE ASCENT summaries harvested in the pdg window
     * (PDG FU-C, U-C2), across all languages. Empty unless `--pdg`. The
     * `callSummaries` phase materialises one `CALL_SUMMARY` self-loop edge per
     * entry once the resolved call graph is known.
     */
    readonly callSummaries: readonly CallSummary[];
    /**
     * Streamed PDG-emit COPY manifest (#2202). Present only when streaming was on
     * (full rebuild + `--pdg` + enabled): the BasicBlock node CSV + per-pair PDG
     * edge CSVs that were flushed to disk during the emit loop, for the persistence
     * step to COPY alongside the structural CSVs. Absent ⇒ the PDG layer (if any)
     * is in the in-memory graph and persists via the normal whole-graph emit.
     */
    readonly pdgEmitManifest?: PdgEmitManifest;
}
/** Select source files that must be materialized for one resolver pass. */
export declare function selectScopeSourcePathsToRead(provider: ScopeResolver, primaryFilePaths: readonly string[], preExtractedByPath: {
    readonly has: (filePath: string) => boolean;
}): string[];
export declare const scopeResolutionPhase: PipelinePhase<ScopeResolutionOutput>;
