/**
 * Receiver-bound CALLS / ACCESSES emit pass — generic 8-case
 * dispatcher consuming `ScopeResolver` for the language-specific bits
 * (super recognizer, field-fallback toggle).
 *
 * **Contract Invariant I4 — case order is load-bearing.** The cases
 * are evaluated in this order; the FIRST that emits an edge wins:
 *
 *   1. **super branch** — `provider.isSuperReceiver(receiverName)` →
 *      MRO walk skipping self
 *   2. **Case 0 (compound)** — receiver has `.` or `(` → compound resolver.
 *      Also emits the interface-dispatch fan-out when the folded receiver type
 *      is an Interface (#2829) — see Case 4, which does the same.
 *   3. **Case 0.5 (implicit `this` receiver)** — GATED: fires only when
 *      the language sets `resolveThisViaEnclosingClass === true` AND the
 *      receiver is literally `this` → enclosing-class + MRO chain walk
 *      with C++ member-name-hiding semantics. Languages that leave the
 *      toggle unset skip this case entirely; their `this` sites fall
 *      through to Case 4 via the synthesized `this` typeBinding (which
 *      emits the interface-dispatch fan-out that this case does not —
 *      as do Cases 0 since #2829 and 3b since #2832; Case 0.5 remains
 *      the only fold-or-walk case without it).
 *   4. **Case 1 (namespace)** — receiver in `namespaceTargets` → exported def
 *   5. **Case 2 (class-name / static receiver)** — receiver resolves to a
 *      class-like binding (Class/Interface/Struct/Record/Enum/Trait) → MRO
 *      walk on that class. Also handles static-style invocations
 *      (`ILogger.Warn(...)`) with kind-aware reason/confidence for
 *      read/write ACCESSES.
 *   6. **Case 3 (dotted typeBinding for namespace prefix)** —
 *      `typeRef.rawName` like `models.User`
 *   7. **Case 3b (chain-typebinding)** — `typeRef.rawName` has a dot
 *      but not a namespace prefix → compound resolver. Also emits the
 *      interface-dispatch fan-out when the folded receiver type is an
 *      Interface (#2832) — same call Cases 0 and 4 make.
 *   8. **Case 4 (simple typeBinding)** — `typeRef.rawName` has no dot →
 *      MRO walk + `findOwnedMember`
 *   9. **Case 5 (value-receiver bridge)** — receiver is a `Const`/`Variable`
 *      whose `nodeId` is referenced as an `ownerId` in `model.methods`
 *      (object-literal services). Last-resort fallback for lowercase
 *      receivers with no class-like or type-binding match. Mirrors
 *      the legacy DAG bridge in `call-processor.ts`.
 *  10. **Case 6 (class-level member receiver)** — `Holder.repo.save(u)`,
 *      where the receiver's head is a CLASS and the one hop past it is a
 *      class-level (`isStatic`) field. Types the receiver from that field
 *      DEF's declared type rather than from a `typeBindings` entry, which
 *      is the thing a per-scope binding map cannot hold for a class that
 *      declares both a static and an instance member of one name. Gated on
 *      Case 0 having declined the same receiver, so it only ever adds an
 *      edge where there was none. Emits the interface-dispatch fan-out
 *      alongside Cases 0, 3b and 4.
 *
 * Reordering or merging cases changes resolution semantics.
 *
 * **Contract Invariant I5 — pre-seeding `seen` is forbidden.** The
 * orchestrator runs this pass FIRST (before `emitReferencesViaLookup`)
 * and consumes the populated `handledSites` set. Pre-seeding `seen`
 * from the shared resolver's emissions (an old optimization) actively
 * suppresses correct emissions for sites the shared resolver also
 * resolved to a wrong target.
 */
import type { ParsedFile } from '../../../../_shared/index.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { SemanticModel } from '../../model/semantic-model.js';
import type { ScopeResolver } from '../contract/scope-resolver.js';
import type { GraphNodeLookup } from '../graph-bridge/node-lookup.js';
import type { WorkspaceResolutionIndex } from '../workspace-index.js';
import { type DecorationStripper } from '../scope/walkers.js';
import type { CalleeIdSink } from '../graph-bridge/callee-id-sink.js';
import { type HeritageTypeArguments } from '../utils/generic-instantiation.js';
import type { ResolutionOutcomeRecorder } from '../resolution-outcome.js';
import type { ReceiverOrigin } from '../resolution-outcome.js';
import type { DecodedReceiverChain } from '../../utils/receiver-chain-codec.js';
/** Subset of `ScopeResolver` consumed by this pass. Accepting the
 *  subset rather than the full provider keeps tests and partial
 *  refactors lighter — callers only need to populate what we read. */
type ReceiverBoundProviderSubset = Pick<ScopeResolver, 'isSuperReceiver' | 'isSuperReceiverInContext' | 'fieldFallbackOnMethodLookup' | 'collapseMemberCallsByCallerTarget' | 'elementTypeOf' | 'hoistTypeBindingsToModule' | 'stripReceiverCastExpressions' | 'constructionSyntax' | 'stripTypePreservingDecoration' | 'resolveQualifiedReceiverMember' | 'namespaceReceiverPaths' | 'resolveReceiverMember' | 'resolveThisViaEnclosingClass' | 'conversionRankFn' | 'conversionOnlyArgTypePrefixes' | 'constraintCompatibility' | 'isStaticOnly' | 'normalizeTypeArgument'>;
/**
 * Is this dropped receiver rooted inside the analyzed program?
 *
 * Asks of the receiver's BASE — the leftmost name the chain hangs off — what
 * this index can DEMONSTRATE. Three answers, and the asymmetry between them is
 * the whole point:
 *
 * - `in-program` — the base's declared type resolves here, or the base itself is
 *   a class, a qualified name, or a value this program declares. A real edge was
 *   lost; the hedge must fire.
 * - `external` — POSITIVE evidence that the target is outside: the language
 *   itself names the base (or its bare declared type) a built-in. `console.log`,
 *   `fetch(...)`, `JSON.stringify` reach code no index contains, so there is no
 *   node an edge could have pointed at and nothing was lost.
 * - `unknown` — everything else. An absence of evidence is NOT evidence of
 *   externality: an unannotated parameter (`function f(svc) { svc.a().b(); }`)
 *   is recorded nowhere in the scope model at all, and calling that "external"
 *   published `epistemic: 'exact'` over a genuinely missing in-program caller —
 *   strictly worse than hedging, because it is a confident wrong answer rather
 *   than an admitted gap. `unknown` counts WITH `in-program` in
 *   `summarizeUnresolvedReceivers`, which is the safe direction.
 *
 * Uses the AST-derived chain base when one was minted, and falls back to the
 * head of the receiver text otherwise — never a regex over the source line.
 *
 * Exported for the unit tests that pin the three-way split; the pass is its only
 * production caller.
 */
export declare function classifyReceiverOrigin(decoded: DecodedReceiverChain | undefined, inScope: string, receiverName: string, scopes: ScopeResolutionIndexes, options?: {
    /** The language's type-preserving decoration stripper. Without it a Go
     *  pointer receiver — `func (h *Host)` binds `h` to the literal `*Host` —
     *  resolves to no class and the whole method body's drops were reported as
     *  external. Same hook the three receiver-chain lookups in
     *  `compound-receiver.ts` already receive. */
    readonly stripTypePreservingDecoration?: DecorationStripper;
    /** `LanguageProvider.isBuiltInName`, threaded through the pass options the
     *  same way `emitFreeCallFallback` receives it. THE only source of positive
     *  external evidence available here; languages that declare no built-in set
     *  simply never produce an `external` verdict, which is the safe default. */
    readonly isBuiltInName?: (name: string) => boolean;
}): ReceiverOrigin;
/**
 * Upper bound on how many implementors ONE interface member may fan out to at a
 * single call site (#2829).
 *
 * Mirrors `MAX_PROPERTY_DISPATCH_FANOUT` in `property-dispatch.ts`, deliberately
 * including its reporting half: a bare cap would silently discard valid dispatch
 * targets, which is the same false-safe silence #2813 was filed about. The
 * default matches that sibling's 32 — the fan-out is a per-call-site product, so
 * an interface with hundreds of implementors (mock proliferation is the usual
 * cause) multiplies the graph without adding information a reader can act on.
 *
 * Override with `GITNEXUS_MAX_INTERFACE_DISPATCH_FANOUT` for a repo with
 * legitimately high implementor counts.
 */
export declare const MAX_INTERFACE_DISPATCH_FANOUT: number;
/** What `emitReceiverBoundCalls` reports back to the orchestrator. */
export interface ReceiverBoundResult {
    /** CALLS/ACCESSES edges emitted by this pass. */
    readonly emitted: number;
    /** Dispatch targets DROPPED because a member exceeded the fan-out cap. */
    readonly dispatchFanoutSkipped: number;
    /** Bounded sample naming which interface members lost targets. */
    readonly dispatchFanoutSkippedNames: readonly string[];
}
export declare function emitReceiverBoundCalls(graph: KnowledgeGraph, scopes: ScopeResolutionIndexes, parsedFiles: readonly ParsedFile[], nodeLookup: GraphNodeLookup, handledSites: Set<string>, provider: ReceiverBoundProviderSubset, index: WorkspaceResolutionIndex, model: SemanticModel, options?: {
    readonly recordResolutionOutcome?: ResolutionOutcomeRecorder;
    /** Resolved-callee-id capture sink (#2227 U2). Threaded in under `--pdg`
     *  OR for callable-flow's direct-target index (#2437, position-filtered);
     *  `undefined` ⇒ zero overhead, byte-identity (R4). Per-file capture
     *  contexts are built from this + `parsed.filePath` in the loop. */
    readonly calleeIdSink?: CalleeIdSink;
    /** `LanguageProvider.isBuiltInName`. Passed through the options bag rather
     *  than widened into `ReceiverBoundProviderSubset`, mirroring how
     *  `emitFreeCallFallback` receives the same hook — the subset exists to keep
     *  test providers small, and this pass reads nothing else off the language
     *  provider. Consumed ONLY by `classifyReceiverOrigin`, so leaving it unset
     *  degrades a drop's label to `unknown` (the safe direction) and changes no
     *  edge. */
    readonly isBuiltInName?: (name: string) => boolean;
    /** The generic arguments each heritage clause instantiated its base with,
     *  from the passes that emitted those heritage edges — the inheritance
     *  pre-pass, and the language resolvers that emit their own (Rust `impl T
     *  for S`, Dart `implements` / `with`) (#2912). Read
     *  ONLY by the interface-dispatch fan-out, to refuse an implementor of an
     *  incompatible instantiation. Absent ⇒ every heritage instantiation reads
     *  as unknown ⇒ the pre-#2912 fan-out, unchanged. */
    readonly heritageTypeArguments?: HeritageTypeArguments;
}): ReceiverBoundResult;
/**
 * Sentinel returned by `pickOverload` when narrowing leaves >1 candidate
 * sharing identical normalized parameter-types. Callers should suppress
 * the CALLS edge AND mark the site as handled so `emitReferencesViaLookup`
 * does not re-emit from the pre-resolved reference index. See
 * `pickOverload` JSDoc for the upstream cause (per-language normalizer
 * collapses distinct types in arity-metadata).
 */
export declare const OVERLOAD_AMBIGUOUS: unique symbol;
export {};
