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
import { generateId } from '../../../../lib/utils.js';
import { lookupOwnedMembersByOwner } from '../../model/owned-members-lookup.js';
import { reconcileOwnership, validateOwnershipParity } from './reconcile-ownership.js';
import { validateBindingsImmutability } from './validate-bindings-immutability.js';
import { extractParsedFile } from '../../scope-extractor-bridge.js';
import { finalizeScopeModel } from '../../finalize-orchestrator.js';
import { resolveReferenceSites } from '../../resolve-references.js';
import { buildGraphNodeLookup } from '../graph-bridge/node-lookup.js';
import { emitFileCfgs, emitFileReachingDefs, emitFileCdg, isEmitSafeCfg, DEFAULT_MAX_CFG_EDGES_PER_FUNCTION, DEFAULT_PDG_MAX_REACHING_DEF_EDGES_PER_FUNCTION, DEFAULT_PDG_MAX_REACHING_DEF_FACTS_PER_FUNCTION, DEFAULT_PDG_MAX_CDG_EDGES_PER_FUNCTION, REACHING_DEF_FACTS_PER_EDGE_CAP, } from '../../cfg/emit.js';
import { createMemoizedReachingDefs } from '../../cfg/reaching-defs.js';
import { emitFileTaint, DEFAULT_PDG_MAX_TAINT_FINDINGS_PER_FUNCTION, DEFAULT_PDG_MAX_TAINT_HOPS, } from '../../taint/emit.js';
import { registerBuiltinTaintModels } from '../../taint/typescript-model.js';
import { getSourceSinkConfig } from '../../taint/source-sink-registry.js';
import { buildFunctionNodeIndex, harvestFileSummaries, } from '../../taint/summary-harvest-driver.js';
import { harvestFileCallSummaries } from '../../taint/summary-harvest-driver.js';
import { resolveDefGraphId } from '../graph-bridge/ids.js';
import { buildPopulatedMethodDispatch } from '../graph-bridge/method-dispatch.js';
import { propagateImportedReturnTypes } from '../passes/imported-return-types.js';
import { emitReceiverBoundCalls, MAX_INTERFACE_DISPATCH_FANOUT, } from '../passes/receiver-bound-calls.js';
import { emitFreeCallFallback } from '../passes/free-call-fallback.js';
import { emitPropertyDispatchCalls, MAX_PROPERTY_DISPATCH_FANOUT, } from '../passes/property-dispatch.js';
import { emitReferencesViaLookup } from '../graph-bridge/references-to-edges.js';
import { buildPropertyNameIndex, emitUniqueNamePropertyAccesses, } from '../passes/unique-name-properties.js';
import { emitReturnShapeMemberAccesses } from '../passes/return-shape-members.js';
import { emitImportedValueReferences } from '../passes/imported-value-refs.js';
import { createCalleeIdAccumulator, } from '../graph-bridge/callee-id-sink.js';
import { emitImportEdges } from '../graph-bridge/imports-to-edges.js';
import { callableFlowSiteKey, collectDeferredIndirectSites, emitCallableValueFlow, } from '../passes/callable-value-flow.js';
import { findEnclosingClassDef, resolveInheritanceBaseInScope } from '../scope/walkers.js';
import { heritageTypeArgumentsKey, } from '../utils/generic-instantiation.js';
import { buildWorkspaceResolutionIndex } from '../workspace-index.js';
import { logHeapProbe } from '../../utils/heap-probe.js';
import { parseTruthyEnv } from '../../utils/env.js';
import { isValueDefinitionLabel } from '../../utils/ast-helpers.js';
import { TransitionalScopeTree } from '../../../../storage/scope-index-store.js';
import { forceGc } from '../../../../storage/parsedfile-store.js';
import { logger } from '../../../logger.js';
/**
 * Emit one class-owned inheritance edge directly (the inheritance pre-pass is
 * the authoritative emitter — see `preEmitInheritanceEdges`). Encapsulates the
 * dual dedup contract so the two sets' joint semantics live in one place:
 *   - `existing` — coarse per-`(caller, target, type)` gate, seeded from the
 *     graph (so this pass is a no-op when the legacy path already emitted it).
 *   - `seen` — per-site key shared with the generic edge bridge so the two
 *     passes never double-emit the same resolution.
 * The `dedupKey` and `rel:` id shape match `tryEmitEdge` exactly, so graph
 * output stays byte-identical. The caller is the enclosing class (NOT the
 * method/constructor `resolveCallerGraphId` would prefer — that broke MRO for
 * C# 12 primary constructors, #1951); the edge type is pre-discriminated.
 */
function emitInheritanceEdgeDirect(graph, seen, existing, callerGraphId, targetGraphId, edgeType, site) {
    const edgeKey = `${edgeType}:${callerGraphId}->${targetGraphId}`;
    const dedupKey = `${edgeKey}:${site.atRange.startLine}:${site.atRange.startCol}`;
    if (existing.has(edgeKey) || seen.has(dedupKey))
        return;
    seen.add(dedupKey);
    existing.add(edgeKey);
    graph.addRelationship({
        id: `rel:${dedupKey}`,
        sourceId: callerGraphId,
        targetId: targetGraphId,
        type: edgeType,
        confidence: 0.85,
        reason: 'scope-resolution: inherits',
    });
}
/**
 * Resolve inheritance reference sites early and pre-emit their EXTENDS edges
 * before MRO construction. This lets template-base captures contribute to the
 * graph in time for `buildMro`, while `handledSites` prevents the generic
 * reference-edge bridge from re-emitting the same sites later.
 *
 * @returns Site keys to seed the downstream handled-site skip set.
 *
 * The generic INSTANTIATION each heritage edge was written with (#2912) goes to
 * `recordTypeArguments` rather than out through the return, because the caller
 * shares that sink with the language heritage hook — see
 * `HeritageTypeArguments` in `utils/generic-instantiation.ts`. This pass is
 * where the pairing exists at all: the site carries the arguments and this is
 * the only code that resolves the site to a (subtype, supertype) pair, so
 * recording it here costs one map write per generic heritage edge, while
 * recovering it downstream would mean redoing the resolution against a graph
 * edge that no longer carries the spelling.
 */
function preEmitInheritanceEdges(graph, scopes, nodeLookup, recordTypeArguments) {
    const handledSites = new Set();
    const seen = new Set();
    // Tracks inheritance edges emitted during this pass so the structural
    // interface-implementation pass (emitDetectedInterfaceImplementations) and
    // repeated `inherits` sites don't double-emit. Starts empty: this pre-pass is
    // the authoritative inheritance emitter — no EXTENDS/IMPLEMENTS edges exist in
    // the graph before it runs (the legacy heritage path was removed in #942).
    const existing = new Set();
    for (const site of scopes.referenceSites) {
        if (site.kind !== 'inherits')
            continue;
        const scope = scopes.scopeTree.getScope(site.inScope);
        const siteKey = scope?.filePath !== undefined ? callableFlowSiteKey(scope.filePath, site.atRange) : undefined;
        if (siteKey !== undefined) {
            // Intentionally suppress every `inherits` site from the generic
            // reference bridge, even when this pre-pass can't emit an EXTENDS
            // edge. The shared bridge resolves the source via
            // `resolveCallerGraphId`, which can degrade class-heritage sites into
            // method-owned EXTENDS edges once methods exist on the class. This
            // pre-pass is the authoritative inheritance emitter and pins the source
            // to the enclosing class (via the `callerGraphId` override below), so
            // suppression keeps `buildMro` and the final graph class-owned.
            handledSites.add(siteKey);
        }
        // Resolve the deriving (caller) class first and reuse it as the enclosing
        // context for qualified-base resolution — avoids a second findEnclosingClassDef
        // walk per qualified site (#1982 perf). Both need the same enclosing class.
        const callerClass = findEnclosingClassDef(site.inScope, scopes);
        if (callerClass === undefined)
            continue;
        const targetDef = resolveInheritanceBaseInScope(site.inScope, site.name, scopes, site.rawQualifiedName, callerClass);
        if (targetDef === undefined)
            continue;
        const callerGraphId = resolveDefGraphId(callerClass.filePath, callerClass, nodeLookup);
        const targetGraphId = resolveDefGraphId(targetDef.filePath, targetDef, nodeLookup);
        if (callerGraphId === undefined || targetGraphId === undefined)
            continue;
        // Discriminate EXTENDS vs IMPLEMENTS by the resolved target's symbol kind:
        // conforming to an interface OR mixing in a trait/protocol is IMPLEMENTS,
        // deriving from a class-like is EXTENDS. The discriminator is purely
        // symbol-kind-driven (no language is named here, per AGENTS.md): a base that
        // resolves to neither an Interface nor a Trait symbol always takes the
        // EXTENDS branch, so such languages are unchanged.
        const edgeType = targetDef.type === 'Interface' || targetDef.type === 'Trait' ? 'IMPLEMENTS' : 'EXTENDS';
        emitInheritanceEdgeDirect(graph, seen, existing, callerGraphId, targetGraphId, edgeType, site);
        // The instantiation this heritage clause wrote (`: IValidator<string>`),
        // keyed by the same graph-id pair the edge itself carries. Only generic
        // bases produce an entry; the sink owns the first-writer-wins rule.
        if (site.typeArguments !== undefined) {
            recordTypeArguments(callerGraphId, targetGraphId, site.typeArguments);
        }
    }
    return handledSites;
}
/**
 * Emit language-inferred structural interface implementations before MRO and
 * interface dispatch are built. Languages such as Go do not declare
 * `implements` explicitly, so their resolver can infer defId-level interface
 * satisfaction from parsed files and this bridge converts those defIds to
 * graph node ids.
 *
 * Existing explicit IMPLEMENTS edges win: the local `existing` set prevents
 * duplicate structural edges and keeps this hook language-neutral. The reason
 * string carries the provider language (`go-structural-implements`) so callers
 * can distinguish inferred edges from source-declared heritage.
 */
function emitDetectedInterfaceImplementations(graph, parsedFiles, nodeLookup, provider, indexes, model) {
    if (provider.detectInterfaceImplementations === undefined)
        return [];
    const graphIdByDefId = new Map();
    for (const parsed of parsedFiles) {
        for (const def of parsed.localDefs) {
            if (def.type !== 'Class' && def.type !== 'Struct' && def.type !== 'Interface')
                continue;
            const graphId = resolveDefGraphId(parsed.filePath, def, nodeLookup);
            if (graphId !== undefined)
                graphIdByDefId.set(def.nodeId, graphId);
        }
    }
    const existing = new Set();
    for (const rel of graph.iterRelationshipsByType('IMPLEMENTS')) {
        existing.add(`${rel.sourceId}->${rel.targetId}`);
    }
    const detected = provider.detectInterfaceImplementations(parsedFiles, indexes, model);
    for (const [interfaceDefId, implementorDefIds] of detected.implementations) {
        const targetId = graphIdByDefId.get(interfaceDefId);
        if (targetId === undefined)
            continue;
        for (const implementor of implementorDefIds) {
            const sourceId = graphIdByDefId.get(implementor.structDefId);
            if (sourceId === undefined)
                continue;
            const edgeKey = `${sourceId}->${targetId}`;
            if (existing.has(edgeKey))
                continue;
            existing.add(edgeKey);
            graph.addRelationship({
                id: generateId('IMPLEMENTS', edgeKey),
                sourceId,
                targetId,
                type: 'IMPLEMENTS',
                confidence: 0.85,
                // The receiver form rides in `reason` because relationships carry no
                // arbitrary properties — adding one would change the relation DDL and
                // move SCHEMA_FINGERPRINT, forcing a full re-analyze for a fact that a
                // string already expresses. `-pointer` means ONLY the pointer type
                // implements: `var x I = T{}` is invalid, `var x I = &T{}` is fine.
                // The unsuffixed form is unchanged from before, so a consumer matching
                // the old string keeps seeing exactly the value-form implementors.
                reason: implementor.receiverForm === 'pointer'
                    ? `${provider.language}-structural-implements-pointer`
                    : `${provider.language}-structural-implements`,
            });
        }
    }
    // The interfaces this provider could not decide. They mint no edges — they
    // exist so a query can report a lower bound instead of a confident zero
    // (#2873); see `undecided-satisfaction.ts`.
    return detected.undecided;
}
export function runScopeResolution(input, provider) {
    const { graph, files } = input;
    const callableFlowOnly = provider.scopeResolutionEdgeMode === 'callable-flow-only';
    const onWarn = input.onWarn ?? (() => { });
    const resolutionOutcomes = [];
    const undecidedSatisfaction = [];
    const recordResolutionOutcome = (outcome) => {
        resolutionOutcomes.push(outcome);
        input.recordResolutionOutcome?.(outcome);
    };
    const PROF = process.env.PROF_SCOPE_RESOLUTION === '1';
    const tStart = PROF ? process.hrtime.bigint() : 0n;
    let fileContents;
    const getFileContents = () => {
        if (fileContents === undefined) {
            fileContents = new Map();
            for (const f of files)
                fileContents.set(f.path, f.content);
        }
        return fileContents;
    };
    // ── Phase 1: extract each file → ParsedFile ────────────────────────────
    const parsedFiles = [];
    let filesSkipped = 0;
    const treeCache = input.treeCache;
    const preExtracted = input.preExtractedParsedFiles;
    let preExtractedHits = 0;
    const progressInterval = files.length > 0 ? Math.max(1, Math.floor(files.length / 50)) : 1;
    input.onProgress?.('extracting', 0, files.length);
    logHeapProbe('sr-extract-start', `lang=${provider.language} files=${files.length}`);
    for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        const file = files[fileIdx];
        let parsed;
        // Fast path: a worker (during the parse phase) already produced a
        // ParsedFile for this file via `extractParsedFile`. Reuse it
        // directly — skips a tree-sitter re-parse on the main thread.
        let reusedPreExtracted = false;
        if (preExtracted !== undefined) {
            parsed = preExtracted.get(file.path);
            if (parsed !== undefined) {
                preExtractedHits++;
                reusedPreExtracted = true;
            }
        }
        if (parsed === undefined) {
            const cachedTree = treeCache?.get(file.path);
            parsed = extractParsedFile(provider.languageProvider, file.content, file.path, onWarn, cachedTree);
            if (parsed === undefined) {
                filesSkipped++;
                continue;
            }
        }
        // Worker-boundary restore: a pre-extracted ParsedFile was produced by
        // `extractParsedFile` running INSIDE a worker, so any capture-time
        // module-level side-channel state (`emitScopeCaptures` side effects that
        // are NOT serialized onto the ParsedFile's scopes/defs — C++ ADL/namespace
        // marks) was populated in the worker process and is missing here. The
        // worker stashed a plain-data snapshot on `parsed.captureSideChannel` (via
        // `collectCaptureSideChannel`); write it back into the module maps now,
        // BEFORE populateOwners consumes the resolved ranges. NO re-parse — that is
        // the #1983 fix. The fresh-extract leg above already populated those marks
        // in this process, so it skips the restore. See
        // `ScopeResolver.applyCaptureSideChannel`.
        if (reusedPreExtracted && provider.applyCaptureSideChannel !== undefined) {
            provider.applyCaptureSideChannel(parsed);
        }
        provider.populateOwners(parsed);
        parsedFiles.push(parsed);
        if ((fileIdx + 1) % progressInterval === 0 || fileIdx === files.length - 1) {
            input.onProgress?.('extracting', fileIdx + 1, files.length);
            logHeapProbe('sr-extract-progress', `lang=${provider.language} idx=${fileIdx + 1}/${files.length} parsedFiles=${parsedFiles.length} preExtractedHits=${preExtractedHits}`);
        }
    }
    if (PROF && preExtracted !== undefined) {
        logger.warn(`[scope-resolution prof] pre-extracted hits: ${preExtractedHits}/${files.length}`);
    }
    logHeapProbe('sr-extract-end', `lang=${provider.language} parsedFiles=${parsedFiles.length} preExtractedHits=${preExtractedHits} skipped=${filesSkipped}`);
    provider.populateWorkspaceOwners?.(parsedFiles, { fileContents: getFileContents() });
    // A callable-flow-only provider has no reason to build the whole-graph
    // lookup or finalize ordinary references when none of its files emitted a
    // callable fact. This keeps the opt-in path proportional to source scanning
    // for repositories that use the provider but no first-class callables.
    if (callableFlowOnly &&
        !parsedFiles.some((parsed) => (parsed.callableFlowSites?.length ?? 0) > 0)) {
        return {
            filesProcessed: parsedFiles.length,
            filesSkipped,
            importsEmitted: 0,
            resolve: { sitesProcessed: 0, referencesEmitted: 0, unresolved: 0 },
            referenceEdgesEmitted: 0,
            referenceSkipped: 0,
            propertyDispatchSkippedKeys: 0,
            importedValueRefEdges: 0,
            uniqueNamePropertyEdges: 0,
            uniqueNamePropertyAmbiguous: 0,
            uniqueNamePropertyNarrowed: 0,
            uniqueNamePropertyAmbiguousNames: [],
            uniqueNamePropertyCrossLanguage: 0,
            uniqueNamePropertyCrossLanguageNames: [],
            resolutionOutcomes,
            undecidedSatisfaction,
            functionSummaries: [],
            callSummaries: [],
        };
    }
    // Reconcile scope-resolution's ownership view into the SemanticModel.
    // See `reconcile-ownership.ts` for the full rationale (Contract
    // Invariant I9). Debug-mode validator runs immediately after to
    // catch drift between `parsed.localDefs` and the registries.
    //
    // PHASE BOUNDARY: `input.model` is `MutableSemanticModel` up to this
    // point (write phase: reconciliation). After this line no further
    // writes are expected — downstream passes consume `readonlyModel`
    // (narrowed to `SemanticModel`) so accidental writes would surface
    // as type errors.
    reconcileOwnership(parsedFiles, input.model);
    validateOwnershipParity(parsedFiles, input.model, onWarn);
    const readonlyModel = input.model;
    if (parsedFiles.length === 0) {
        return {
            filesProcessed: 0,
            filesSkipped,
            importsEmitted: 0,
            resolve: { sitesProcessed: 0, referencesEmitted: 0, unresolved: 0 },
            referenceEdgesEmitted: 0,
            referenceSkipped: 0,
            propertyDispatchSkippedKeys: 0,
            importedValueRefEdges: 0,
            uniqueNamePropertyEdges: 0,
            uniqueNamePropertyAmbiguous: 0,
            uniqueNamePropertyNarrowed: 0,
            uniqueNamePropertyAmbiguousNames: [],
            uniqueNamePropertyCrossLanguage: 0,
            uniqueNamePropertyCrossLanguageNames: [],
            resolutionOutcomes,
            undecidedSatisfaction,
            functionSummaries: [],
            callSummaries: [],
        };
    }
    const tExtract = PROF ? process.hrtime.bigint() : 0n;
    // ── Phase 2: finalize → ScopeResolutionIndexes ─────────────────────────
    input.onProgress?.('analyzing types', files.length, files.length);
    const allFilePaths = new Set(parsedFiles.map((f) => f.filePath));
    logHeapProbe('sr-pre-nodeLookup', `lang=${provider.language}`);
    const nodeLookup = input.prebuiltNodeLookup ?? buildGraphNodeLookup(graph);
    logHeapProbe('sr-post-nodeLookup', `lang=${provider.language}`);
    const resolutionConfig = input.resolutionConfig;
    const finalized = finalizeScopeModel(parsedFiles, {
        hooks: {
            resolveImportTarget: (targetRaw, fromFile, _workspaceIndex, parsedImport) => provider.resolveImportTarget(targetRaw, fromFile, allFilePaths, resolutionConfig, {
                parsedFiles,
                parsedImport,
            }),
            isNamespaceImport: (parsedImport, targetFile, fromFile) => provider.isNamespaceImport?.(parsedImport, targetFile, fromFile) ?? false,
            expandsWildcardTo: (targetModuleScope) => provider.expandsWildcardTo?.(targetModuleScope, parsedFiles) ?? [],
            mergeBindings: (existing, incoming, scopeId) => provider.mergeBindings(existing, incoming, scopeId),
        },
    });
    logHeapProbe('sr-post-finalize', `lang=${provider.language}`);
    // One store and ONE writer rule for heritage instantiations (#2912), shared by
    // the pre-pass below and by the language hook further down — a heritage shape
    // the pre-pass cannot express (Rust `impl T for S`, Dart `implements`) records
    // through the same sink. FIRST writer wins: a repeated (sub, super) pair is a
    // partial declaration or a re-listed base, and letting a later entry overwrite
    // the first would make dispatch depend on file order.
    const heritageTypeArguments = new Map();
    const recordHeritageTypeArguments = (subtypeGraphId, supertypeGraphId, typeArguments) => {
        if (typeArguments.length === 0)
            return;
        const key = heritageTypeArgumentsKey(subtypeGraphId, supertypeGraphId);
        if (!heritageTypeArguments.has(key))
            heritageTypeArguments.set(key, typeArguments);
    };
    const preEmittedInheritanceSites = callableFlowOnly
        ? new Set()
        : preEmitInheritanceEdges(graph, finalized, nodeLookup, recordHeritageTypeArguments);
    // Call-based heritage hook (e.g., Ruby include/extend/prepend) — emits
    // IMPLEMENTS edges that `preEmitInheritanceEdges` cannot produce because
    // the heritage declarations are syntactic method calls, not grammar-level
    // heritage clauses. Must run BEFORE `buildMro` so MRO construction sees
    // the freshly-emitted IMPLEMENTS edges.
    if (!callableFlowOnly) {
        provider.emitHeritageEdges?.(graph, parsedFiles, nodeLookup, finalized, recordHeritageTypeArguments);
    }
    // Implicit IMPORTS-edge hook — for languages whose files have compiler-
    // implicit cross-file visibility (no syntactic import statement). The
    // finalized-ImportEdge pipeline (`emitImportEdges`) cannot produce these
    // because there is no `ImportEdge` to materialize. Idempotent.
    if (!callableFlowOnly) {
        provider.emitImplicitImportEdges?.(graph, parsedFiles, nodeLookup, resolutionConfig);
    }
    // Rebuild the node lookup after heritage-edge emission. Languages like
    // Ruby create Property graph nodes inside `emitHeritageEdges`; those
    // nodes must be visible to downstream passes (`emitReceiverBoundCalls`
    // resolves write-access targets via `resolveDefGraphId` which consults
    // `nodeLookup`). Without this rebuild, Property nodes added by the
    // heritage hook are invisible and ACCESSES edges silently fail to emit.
    const postHeritageNodeLookup = !callableFlowOnly && provider.emitHeritageEdges !== undefined
        ? buildGraphNodeLookup(graph)
        : nodeLookup;
    if (!callableFlowOnly) {
        undecidedSatisfaction.push(...emitDetectedInterfaceImplementations(graph, parsedFiles, postHeritageNodeLookup, provider, finalized, readonlyModel));
    }
    const mroByClassDefId = provider.buildMro(graph, parsedFiles, postHeritageNodeLookup);
    const extendsOnlyMroByClassDefId = provider.buildExtendsOnlyMro?.(graph, parsedFiles, postHeritageNodeLookup);
    // Replace the empty MethodDispatchIndex that finalizeScopeModel
    // builds by design with the populated one derived from the
    // language's MRO. Spread produces a fresh `ScopeResolutionIndexes`
    // instead of mutating the finalized result through an `as` cast —
    // downstream passes get an object whose readonly guarantees match
    // the type system.
    const indexes = {
        ...finalized,
        methodDispatch: buildPopulatedMethodDispatch(mroByClassDefId, extendsOnlyMroByClassDefId),
    };
    // Build the workspace resolution index ONCE — scope-valued lookups
    // (`classScopeByDefId`, `moduleScopeByFile`) that `SemanticModel`
    // cannot carry. Must run AFTER `populateOwners` (so owned defs are
    // attributed correctly) and AFTER finalize (so module-scope
    // bindings are available).
    // Pass the scopeTree so the index's class/module Scope lookups are id-backed
    // views that delegate to it (out-of-core scope index) — the index pins no Scope objects, so the
    // disk seal can reclaim them. Byte-identical: the view returns the same Scope
    // the resident tree holds (or a value-identical revived one in disk mode).
    const workspaceIndex = buildWorkspaceResolutionIndex(parsedFiles, indexes.scopeTree);
    logHeapProbe('sr-post-workspaceIndex', `lang=${provider.language}`);
    // Cross-file implicit-namespace visibility (C#). Must run before
    // propagateImportedReturnTypes so the latter pass sees siblings'
    // class bindings when chasing return-type chains across files.
    // The hook writes to `bindingAugmentations` only; finalized
    // `indexes.bindings` remains immutable post-finalize (I8).
    if (provider.populateNamespaceSiblings !== undefined) {
        provider.populateNamespaceSiblings(parsedFiles, indexes, {
            fileContents: getFileContents(),
            treeCache,
            resolutionConfig,
        });
    }
    const tFinalize = PROF ? process.hrtime.bigint() : 0n;
    // Cross-package namespace typeBinding mirroring. Runs before
    // propagateImportedReturnTypes so the SCC-ordered pass sees the
    // mirrored bindings.
    if (provider.mirrorNamespaceTypeBindings !== undefined) {
        provider.mirrorNamespaceTypeBindings(parsedFiles, indexes, workspaceIndex, resolutionConfig);
    }
    // Cross-file return-type propagation (Contract Invariant I3 timing:
    // after finalize, before resolve). Split-timed separately so the
    // SCC-ordered pass's cost is observable (PR #1050 made this O(files)
    // with chain-follow per importer; quadratic regressions show up
    // here, not in finalize).
    if (provider.propagatesReturnTypesAcrossImports !== false) {
        propagateImportedReturnTypes(parsedFiles, indexes, workspaceIndex);
    }
    const tRangeBindStart = PROF ? process.hrtime.bigint() : 0n;
    if (provider.populateRangeBindings !== undefined) {
        provider.populateRangeBindings(parsedFiles, indexes, {
            fileContents: getFileContents(),
            treeCache,
        });
    }
    const tPropagate = PROF ? process.hrtime.bigint() : 0n;
    // Opt-in I8 invariant guard. Runs once after all post-finalize hooks
    // (`populateNamespaceSiblings`, `propagateImportedReturnTypes`) have
    // had a chance to drift, so a single sweep covers the full
    // post-finalize surface visible to `resolveReferenceSites`. No-op in
    // default CLI runs; enabled by NODE_ENV=development or
    // VALIDATE_SEMANTIC_MODEL=1.
    validateBindingsImmutability(indexes, onWarn);
    // ── Phase 3: resolve references via Registry.lookup ────────────────────
    input.onProgress?.('resolving references', files.length, files.length);
    const registryProviders = {
        arityCompatibility: provider.arityCompatibility,
    };
    const { referenceIndex, stats: resolveStats } = resolveReferenceSites({
        scopes: indexes,
        providers: registryProviders,
        ownedMembersByOwner: (ownerDefId, memberName) => lookupOwnedMembersByOwner(readonlyModel, ownerDefId, memberName),
    });
    const tResolve = PROF ? process.hrtime.bigint() : 0n;
    logHeapProbe('sr-post-resolve', `lang=${provider.language}`);
    // Value defs bound at MODULE LEVEL. A read of a block-local `const` must not
    // mint an edge — that would retain the inert locals `pruneLocalSymbols` drops.
    //
    // Built HERE, above the out-of-core seal, and deliberately from `parsedFiles`
    // rather than `emitParsedFiles`. The seal below replaces the latter with a
    // scope-STRIPPED copy, so building this after it walked `scopes: []` for every
    // file and produced an empty set — which the filter then reads as "no def is
    // module-level" and drops EVERY `Const`/`Variable`/`Static` ACCESSES edge in
    // the repo, in all languages, on the one path (`GITNEXUS_DISK_SCOPE_INDEX=1`)
    // taken by the largest repos. Nothing failed and nothing logged; the edges
    // were simply absent, which is the confident-empty answer this PR exists to
    // remove.
    //
    // ── The question is "is this def FUNCTION-LOCAL?", so ask exactly that ──
    //
    // This was first written as an ALLOWLIST of module-scope value defs, and that
    // shape carried a defect that only shows outside JavaScript. A value def is
    // not partitioned into {module-level, block-local}; there is a third home —
    // a CLASS body. Java/C# fields and Python class attributes live there, and an
    // allowlist keyed on "module level" excludes all of them by construction.
    // Worse, the guard written to make that safe could not fire: the set is armed
    // whenever a Module scope is FOUND, and Java has module scopes while having no
    // module-level values at all, so for Java it armed permanently empty.
    //
    // Inverting it removes the whole class. A BLOCKLIST of defs positively
    // identified as function-local fails safe: anything the walk does not
    // recognise — a Java field, a Python class attribute, a language whose scopes
    // could not be inspected at all — is emitted rather than dropped. That also
    // retires `moduleScopesInspected`; there is nothing left to arm, because an
    // empty blocklist and an uninspected one mean the same thing and both mean
    // "emit". The failure mode moves from "silently deletes a whole edge class"
    // to "retains an inert local", which is the direction this work wants.
    //
    // Built HERE, above the out-of-core seal, and deliberately from `parsedFiles`
    // rather than `emitParsedFiles`. The seal below replaces the latter with a
    // scope-STRIPPED copy, so building this after it walked `scopes: []` for every
    // file and produced an empty set. Under the old allowlist that read as "no def
    // is module-level" and dropped EVERY `Const`/`Variable`/`Static` ACCESSES edge
    // in the repo on the one path (`GITNEXUS_DISK_SCOPE_INDEX=1`) taken by the
    // largest repos. Under the blocklist the same mistake would merely stop
    // filtering — still wrong, still worth the ordering, no longer catastrophic.
    //
    // A scope is function-local when its chain to the root passes through a
    // `Function`. `Block`/`Expression`/`Object` alone are not enough: a bare block
    // at module level still holds module-level values, and a `Namespace` nested in
    // a function IS local, which the chain walk gets right for free.
    const functionLocalValueDefIds = new Set();
    for (const parsed of parsedFiles) {
        const scopeById = new Map(parsed.scopes.map((sc) => [sc.id, sc]));
        for (const scope of parsed.scopes) {
            let cursor = scope;
            let insideFunction = false;
            while (cursor !== undefined) {
                if (cursor.kind === 'Function') {
                    insideFunction = true;
                    break;
                }
                cursor = cursor.parent === null ? undefined : scopeById.get(cursor.parent);
            }
            if (!insideFunction)
                continue;
            for (const [, refs] of scope.bindings) {
                for (const ref of refs) {
                    if (isValueDefinitionLabel(ref.def.type)) {
                        functionLocalValueDefIds.add(ref.def.nodeId);
                    }
                }
            }
        }
    }
    // ── Out-of-core scope seal boundary ─────────────────────────────────────
    // Pass-A (finalize + propagate + resolve) is done; all whole-language reads
    // of `Scope.bindings` are behind us. Emit reaches scopes ONLY via
    // `scopeTree.getScope` (a point lookup), so seal the TransitionalScopeTree to
    // disk now and drop the resident scopes. The scopes are pinned from THREE
    // sides: (1) the model's frozen `scopeTree` — released by `seal()` nulling its
    // resident backing from the inside; (2) `input.preExtractedParsedFiles` (held
    // by the caller for its own post-run release) — released here since run.ts is
    // its last reader after extract; (3) this function's `parsedFiles` — replaced
    // by a scope-stripped copy that keeps only what emit reads (referenceSites /
    // filePath / localDefs). All three released → the heavy payload is collectible.
    let emitParsedFiles = parsedFiles;
    if (input.scopeIndexStorePath !== undefined &&
        parseTruthyEnv(process.env.GITNEXUS_DISK_SCOPE_INDEX) &&
        indexes.scopeTree instanceof TransitionalScopeTree) {
        logHeapProbe('sr-seal-pre', `lang=${provider.language}`);
        indexes.scopeTree.seal(input.scopeIndexStorePath);
        emitParsedFiles = parsedFiles.map((p) => ({ ...p, scopes: [] }));
        parsedFiles.length = 0;
        if (preExtracted !== undefined)
            preExtracted.clear();
        forceGc();
        logHeapProbe('sr-seal-post', `lang=${provider.language}`);
    }
    // ── Phase 4: emit graph edges (LOAD-BEARING ORDER — see I1) ────────────
    input.onProgress?.('linking symbols', files.length, files.length);
    const handledSites = new Set(preEmittedInheritanceSites);
    const deferredIndirectSites = collectDeferredIndirectSites(emitParsedFiles, indexes);
    const callableArgumentSites = new Set();
    if (input.pdg !== true && deferredIndirectSites.size > 0) {
        for (const parsed of emitParsedFiles) {
            for (const site of parsed.callableFlowSites ?? []) {
                if (site.kind === 'argument') {
                    callableArgumentSites.add(callableFlowSiteKey(parsed.filePath, site.callSite));
                }
            }
        }
    }
    // Resolved-callee-id accumulator (#2227 U2 + callable-value-flow). Created
    // for PDG OR when indirect-call facts need direct targets for actual→formal
    // propagation. Populated below at every CALLS emit path before dedup; the CFG
    // join still consumes it only inside the `input.pdg` block.
    const calleeIdAccumulator = input.pdg === true || deferredIndirectSites.size > 0
        ? createCalleeIdAccumulator(input.pdg === true
            ? undefined
            : (filePath, line, col) => callableArgumentSites.has(`${filePath}:${line}:${col}`))
        : undefined;
    const receiverBound = callableFlowOnly
        ? {
            emitted: 0,
            dispatchFanoutSkipped: 0,
            dispatchFanoutSkippedNames: [],
        }
        : emitReceiverBoundCalls(graph, indexes, emitParsedFiles, postHeritageNodeLookup, handledSites, provider, workspaceIndex, readonlyModel, {
            recordResolutionOutcome,
            calleeIdSink: calleeIdAccumulator,
            // The pass's only source of positive EXTERNAL evidence for a dropped
            // receiver (`console.log`, `fetch(...)`). Same hook, same spelling as
            // the `emitFreeCallFallback` wiring below.
            isBuiltInName: provider.languageProvider.isBuiltInName,
            // What each heritage clause instantiated its base with, so the
            // interface-dispatch fan-out can refuse an incompatible instantiation
            // (#2912). Empty under `callableFlowOnly`, which emits no dispatch.
            heritageTypeArguments,
        });
    const receiverExtras = receiverBound.emitted;
    if (receiverBound.dispatchFanoutSkipped > 0) {
        // Never drop dispatch coverage silently (#2829) — same contract as the
        // property-dispatch cap below. An interface member over the cap loses real
        // implementors, so `impact()` on those implementations under-reports; an
        // operator has to be able to see WHICH member lost them.
        logger.warn({
            lang: provider.language,
            dispatchFanoutSkipped: receiverBound.dispatchFanoutSkipped,
            dispatchFanoutSkippedNames: receiverBound.dispatchFanoutSkippedNames,
            fanoutCap: MAX_INTERFACE_DISPATCH_FANOUT,
        }, 'interface-dispatch: members over the fan-out cap dropped implementors (their CALLS edges were not emitted)');
    }
    const unresolvedReceiverExtras = !callableFlowOnly && provider.emitUnresolvedReceiverEdges !== undefined
        ? provider.emitUnresolvedReceiverEdges(graph, indexes, emitParsedFiles, postHeritageNodeLookup, handledSites, readonlyModel)
        : 0;
    const freeCallExtras = callableFlowOnly
        ? 0
        : emitFreeCallFallback(graph, indexes, emitParsedFiles, postHeritageNodeLookup, referenceIndex, handledSites, readonlyModel, workspaceIndex, {
            allowGlobalFallback: provider.allowGlobalFreeCallFallback === true,
            constructorCallTargetsClass: provider.constructorCallTargetsClass === true,
            isFileLocalDef: provider.isFileLocalDef,
            isBuiltInName: provider.languageProvider.isBuiltInName,
            freeCallsRequireInstanceOwnership: provider.freeCallsRequireInstanceOwnership === true,
            isCallableVisibleFromCaller: provider.isCallableVisibleFromCaller,
            resolveAdlCandidates: provider.resolveAdlCandidates,
            resolveQualifiedFreeCall: provider.resolveQualifiedFreeCall,
            conversionRankFn: provider.conversionRankFn,
            conversionOnlyArgTypePrefixes: provider.conversionOnlyArgTypePrefixes,
            constraintCompatibility: provider.constraintCompatibility,
            recordResolutionOutcome,
            calleeIdSink: calleeIdAccumulator,
            skipSites: deferredIndirectSites,
        });
    const referenceSkipSites = new Set(handledSites);
    for (const key of deferredIndirectSites)
        referenceSkipSites.add(key);
    const { emitted, skipped } = callableFlowOnly
        ? { emitted: 0, skipped: 0 }
        : emitReferencesViaLookup(graph, indexes, referenceIndex, postHeritageNodeLookup, referenceSkipSites, calleeIdAccumulator, 
        // A blocklist, so it needs no arming: empty means "nothing identified as
        // function-local", which is also what an uninspected repo means, and
        // both correctly emit. See the build site above for why the earlier
        // allowlist could not be made safe this way.
        functionLocalValueDefIds);
    // Last-resort property resolution by workspace-unique name (A1/A5). Runs
    // after every precise pass and only sees what they left behind, so a
    // scope-resolved target always wins. Sites the generic bridge already
    // resolved are excluded explicitly: `graph.addRelationship` is
    // first-write-wins per edge id, which stops a DUPLICATE but not a second
    // edge to a DIFFERENT target, and second-guessing a resolved receiver is
    // exactly the wrong-edge-in-the-safety-gate case this must not create.
    const uniqueNameSkipSites = new Set(referenceSkipSites);
    for (const [fromScope, refs] of referenceIndex.bySourceScope) {
        const fromFilePath = indexes.scopeTree.getScope(fromScope)?.filePath;
        if (fromFilePath === undefined)
            continue;
        for (const ref of refs) {
            uniqueNameSkipSites.add(callableFlowSiteKey(fromFilePath, ref.atRange));
        }
    }
    // Gated on the language's own field-name-fallback policy. A statically-typed
    // language sets `fieldFallbackOnMethodLookup: false` precisely because
    // matching a member by name over-connects when a real type system could have
    // answered exactly; inferring an ACCESSES edge by name is the same claim, so
    // it must obey the same opt-out rather than route around it.
    // Cross-file value references (A2): the read/write counterpart to
    // `emitFreeCallFallback`. Runs BEFORE unique-name inference so a precise
    // import-resolved target always wins over a name guess.
    const importedValueRefs = callableFlowOnly
        ? { emitted: 0 }
        : emitImportedValueReferences(graph, indexes, emitParsedFiles, postHeritageNodeLookup, uniqueNameSkipSites);
    // A language that opts out of name fallback still gets DETECTION. Skipping
    // the pass outright also skipped its reporting, so a TypeScript read whose
    // only anchor is JavaScript answered the same silent empty as the JS-read /
    // TS-anchor case R3-1 was filed about — the identical defect, mirrored.
    // `reportOnly` counts without emitting: no edge, no inference, no change to
    // what the opt-out protects.
    // PRECISE first (R3-5). A call result's return shape names WHICH producer a
    // receiver holds, so it answers exactly the case name inference must refuse:
    // several functions returning the same field name. Sites it resolves are
    // added to the skip set, so the fallback below never second-guesses them.
    const sharedPropertyIndex = input.prebuiltPropertyNameIndex ?? buildPropertyNameIndex(graph);
    const returnShapeMembers = callableFlowOnly
        ? { emitted: 0, memberNotOnShape: 0 }
        : emitReturnShapeMemberAccesses(graph, indexes, emitParsedFiles, postHeritageNodeLookup, uniqueNameSkipSites, sharedPropertyIndex, uniqueNameSkipSites);
    const nameFallbackDisabled = provider.fieldFallbackOnMethodLookup === false;
    const uniqueNameProperties = callableFlowOnly
        ? {
            emitted: 0,
            ambiguous: 0,
            narrowed: 0,
            ambiguousNames: [],
            crossLanguageOnly: 0,
            crossLanguageOnlyNames: [],
        }
        : emitUniqueNamePropertyAccesses(graph, indexes, emitParsedFiles, postHeritageNodeLookup, uniqueNameSkipSites, finalized, sharedPropertyIndex, nameFallbackDisabled);
    // value-ref registrations (#2437): USES edges at the registration sites
    // plus field-based dispatch — synthesized CALLS from member-call sites to
    // functions registered under the same property key. This runs after the
    // ordinary precise passes but before callable-value-flow: property-dispatched
    // wrapper calls must populate the callee accumulator before actual→formal
    // propagation. `graph.addRelationship` remains first-write-wins, so precise
    // edges already emitted for a site retain ownership.
    const propertyDispatch = callableFlowOnly
        ? { usesEmitted: 0, callsEmitted: 0, skippedKeys: 0, skippedKeyNames: [] }
        : emitPropertyDispatchCalls(graph, indexes, emitParsedFiles, postHeritageNodeLookup, calleeIdAccumulator);
    if (propertyDispatch.skippedKeys > 0) {
        // Never drop dispatch coverage silently: a hook table larger than the
        // fan-out cap means member calls through those keys get no synthesized
        // CALLS — the #2437 false-safe gap reappears for exactly those keys.
        logger.warn({
            lang: provider.language,
            skippedKeys: propertyDispatch.skippedKeys,
            skippedKeyNames: propertyDispatch.skippedKeyNames,
            fanoutCap: MAX_PROPERTY_DISPATCH_FANOUT,
        }, 'property-dispatch: keys over the fan-out cap were dropped (no CALLS synthesized for them)');
    }
    const callableValueFlow = calleeIdAccumulator === undefined
        ? {
            emitted: 0,
            resolvedInvokes: 0,
            ambiguousInvokes: 0,
            unmatchedInvokes: 0,
            iterations: 0,
        }
        : emitCallableValueFlow({
            graph,
            scopes: indexes,
            parsedFiles: emitParsedFiles,
            nodeLookup: postHeritageNodeLookup,
            calleeIds: calleeIdAccumulator,
            language: provider.language,
            collapseByCallerTarget: provider.collapseMemberCallsByCallerTarget === true,
            isCallableValueTarget: provider.isCallableValueTarget,
            hasFileLocalCallableLinkage: provider.hasFileLocalCallableLinkage,
            onWarn: (warning) => logger.warn(warning, 'callable-value-flow: candidate set exceeded the cap; no partial CALLS emitted'),
        });
    const importsEmitted = callableFlowOnly
        ? 0
        : emitImportEdges(graph, indexes.imports, indexes.scopeTree, provider.importEdgeReason);
    // Language-specific supplementary edges (e.g. Vue template-derived
    // BINDS_EVENT_HANDLER / EMITS_EVENT / CALLS / ACCESSES edges).
    // Runs last so the full graph — including import edges — is visible.
    if (!callableFlowOnly && provider.emitPostResolutionEdges !== undefined) {
        provider.emitPostResolutionEdges(graph, emitParsedFiles, postHeritageNodeLookup, indexes, {
            fileContents: getFileContents(),
            resolutionConfig,
        });
    }
    // ── CFG/PDG emission (#2081 M1, opt-in via `--pdg`) ──────────────────────
    // Emit BasicBlock nodes + CFG edges from each ParsedFile's worker-built
    // `cfgSideChannel`, HERE — the last point inside scope-resolution where the
    // ParsedFiles are still loaded (`emitParsedFiles` carries the channel; the
    // disk store is cleared right after this orchestrator returns, see phase.ts).
    // A post-`mro` phase would read empty data (KTD1). Off by default ⇒ zero
    // BasicBlock/CFG nodes/edges and a byte-identical graph.
    // Accumulated M2 reaching-defs time (solve + dedup + REACHING_DEF emit),
    // reported as the PROF `pdg=` segment. It is a SUBSET of `emit=` — the M1
    // CFG emit and the M2 solve interleave per file, so a separate checkpoint
    // pair can't bracket them; without this accumulator the M2 cost would
    // silently disappear into `emit=` and field regressions would be invisible.
    let pdgMs = 0;
    // M4 (#2084 U1): per-function taint summaries harvested in the pdg window,
    // returned on the stats for the cross-function fixpoint phase. Function-scoped
    // so the return (below the pdg block) can read it; empty on non-pdg runs.
    const harvestedSummaries = [];
    let summaryUnresolved = 0;
    // FU-C (U-C2): per-function RETURN-VALUE ASCENT summaries harvested in the
    // pdg window for the whole-program CALL_SUMMARY emit phase. Function-scoped
    // (read by the return below the pdg block); empty on non-pdg runs.
    const harvestedCallSummaries = [];
    let callSummaryUnresolved = 0;
    // M3 (#2083 U4): accumulated taint time (match + taint-side solve +
    // propagate + TAINTED/SANITIZES emit), a sibling of `pdgMs` for the same
    // reason — it interleaves per file inside `emit=`, so only an accumulator
    // can bracket it. Printed as the PROF `taint=` segment.
    let taintMs = 0;
    if (input.pdg === true) {
        // Streaming target (#2202): when a sink is provided, BasicBlock nodes +
        // intra-file PDG edges are routed to CSV-on-disk through it instead of
        // accumulating in `graph`. The function-node index below is still built
        // from the real `graph` (Function/Method nodes live there, never the sink).
        const pdgTarget = input.pdgEmitSink ?? graph;
        let cfgBlocks = 0;
        let cfgEdges = 0;
        let cfgDroppedEdges = 0;
        let rdEdges = 0;
        let rdDropped = 0;
        let rdFacts = 0;
        let rdTruncated = 0;
        let cdgEdges = 0;
        let cdgDropped = 0;
        let cdgSkippedUnsound = 0;
        // ── M3 taint setup (#2083 U4) ────────────────────────────────────────
        // Explicit model-registration seam (idempotent, cheap) — the registry
        // stays empty on non-pdg runs, preserving default-run parity. The
        // registry is keyed by SupportedLanguages enum values, and
        // ScopeResolver.language is registered under those same constants -
        // the join is direct equality, with no mapping table. A language without a
        // registered spec (go, ruby, ...) skips taint entirely: no work, no warn spam
        // (KTD8).
        registerBuiltinTaintModels();
        const taintSpec = getSourceSinkConfig(provider.language);
        // Taint-side solver fact cap: the SAME derivation emitFileReachingDefs
        // uses for the RD projection (edge cap × headroom factor, 0 ⇒ unlimited),
        // so taint coverage and RD coverage truncate together — a function is
        // never a taint coverage gap while its RD projection computed, and the
        // RD layer's per-function truncation warn already names it.
        const rdEdgeCap = input.pdgMaxReachingDefEdgesPerFunction ?? DEFAULT_PDG_MAX_REACHING_DEF_EDGES_PER_FUNCTION;
        const taintLimits = {
            maxFindingsPerFunction: input.pdgMaxTaintFindingsPerFunction ?? DEFAULT_PDG_MAX_TAINT_FINDINGS_PER_FUNCTION,
            maxHops: input.pdgMaxTaintHops ?? DEFAULT_PDG_MAX_TAINT_HOPS,
            maxFacts: rdEdgeCap > 0 ? rdEdgeCap * REACHING_DEF_FACTS_PER_EDGE_CAP : 0,
        };
        // Cross-file aggregate of EVERY TaintEmitResult counter (the M2 emit
        // result shipped with two fields dropped on the floor — R4 forbids that
        // here; gaps/drops feed the unconditional warn below, volume feeds the
        // per-language debug line).
        const taintTotals = {
            analyzed: 0,
            noMatch: 0,
            unsafeSites: 0,
            gapTruncated: 0,
            gapOverflow: 0,
            gapNoFacts: 0,
            findings: 0,
            kills: 0,
            dropped: 0,
            hopsTruncated: 0,
            gapExamples: [],
            dropExamples: [],
        };
        // M4 (#2084 U1): per-function summary harvest. The functionish-node index
        // is built ONCE (whole-graph scan) and reused across every file; summaries
        // accumulate here and ride out on the stats for the cross-function fixpoint
        // phase. Only built when the language has a registered taint model.
        // Built whenever pdg is on (NOT gated on taintSpec): the FU-C call-summary
        // harvest needs it for EVERY language (it is pure data-dependence, no taint
        // model), and the taint summary harvest reuses it when taintSpec is present.
        const fnNodeIndex = input.prebuiltFunctionNodeIndex ?? buildFunctionNodeIndex(graph);
        for (const pf of emitParsedFiles) {
            const cfgs = pf.cfgSideChannel;
            // Defensive: cfgSideChannel is opaque (`unknown`) and crosses the cache /
            // durable store. A stale or wrong-shape value (e.g. a pre-SCHEMA_BUMP
            // shard that slipped the version gate) must skip emission, not throw a
            // TypeError mid-graph-build and abort scope-resolution for the language.
            if (!Array.isArray(cfgs) || cfgs.length === 0)
                continue;
            // Cross-pass per-file dedup (#2202): when streaming, a file whose PDG
            // already streamed in a prior language pass (e.g. a `.ts` module pulled
            // into the Vue context pass) would re-emit identical ids from the same
            // cfgSideChannel — the dedup-free streaming sink would double the rows.
            // Skip it here; the in-memory-graph path needs no skip (its Map dedups).
            if (input.pdgEmittedFiles !== undefined) {
                if (input.pdgEmittedFiles.has(pf.filePath))
                    continue;
                input.pdgEmittedFiles.add(pf.filePath);
            }
            try {
                // Per-element emit-safety filter (mirrors the parsedfile-store
                // reviver's POLICY: valid elements in a mixed array still emit; junk
                // is warned and skipped). isEmitSafeCfg lives in cfg/emit.ts next to
                // the id templating it defends — see its doc for why anchor-field and
                // endpoint-membership checks are load-bearing. Runs INSIDE the try so
                // even a predicate-time throw (e.g. a hostile getter) is isolated.
                const wellFormed = cfgs.filter(isEmitSafeCfg);
                if (wellFormed.length < cfgs.length) {
                    logger.warn(`[cfg] ${pf.filePath}: skipped ${cfgs.length - wellFormed.length} malformed ` +
                        `cfgSideChannel element(s) (bad shape, missing id-anchor fields, or edge ` +
                        `endpoints matching no block) — CFG for those functions omitted`);
                }
                if (wellFormed.length === 0)
                    continue;
                // U3 hook (#2227): the resolved-callee-id map for this file is
                // `calleeIdAccumulator?.get(pf.filePath)` — joined here by exact
                // call-site position to emit `BasicBlock.calleeIds`. Captured above at
                // the three CALLS emit paths (U2); wired into `emitFileCfgs` by U3.
                const emitted = emitFileCfgs(pdgTarget, wellFormed, input.pdgMaxEdgesPerFunction ?? DEFAULT_MAX_CFG_EDGES_PER_FUNCTION, 
                // Log cap-overflow drops UNCONDITIONALLY (not via input.onWarn, which is
                // gated behind the semantic-model validator and silent in production) so
                // the per-function edge cap never truncates the CFG silently (R6/KTD6).
                (message) => logger.warn(message), 
                // U3 (#2227): the resolved-callee-id map for this file (captured at the
                // three CALLS emit paths in U2), joined by exact call-site position to
                // emit `BasicBlock.calleeIds`. Callable-flow may also have allocated
                // the accumulator in a normal run, but this join remains PDG-only.
                calleeIdAccumulator?.get(pf.filePath));
                cfgBlocks += emitted.blocks;
                cfgEdges += emitted.edges;
                cfgDroppedEdges += emitted.droppedEdges;
                // R6 (#2227 tri-review-2): release this file's captured id map now that
                // emitFileCfgs has consumed it — the CALLS passes fully precede this loop
                // and each file is read exactly once, so this bounds the accumulator to one
                // file's call sites instead of holding the whole repo's for the phase.
                calleeIdAccumulator?.delete(pf.filePath);
                // M2 (#2082 U4): reaching definitions over the same validated CFGs.
                // In-memory facts are computed per function and dropped after the
                // bounded (defBlock, useBlock, binding) projection is persisted —
                // M3 recomputes via the same pure solver in-phase (KTD8). Timing is
                // PROF-gated like every other checkpoint here (zero cost when off).
                // U12: one memoized RD solver per file, shared by the RD-emit + call-
                // summary + taint + summary passes, so the per-function fixpoint runs once
                // per (limits) bucket instead of 3–4× (#2227 tri-review). File-scoped: it
                // is re-created each iteration, so its per-function facts drop with the file.
                const rdSolve = createMemoizedReachingDefs();
                const t0 = PROF ? performance.now() : 0;
                const rd = emitFileReachingDefs(pdgTarget, wellFormed, input.pdgMaxReachingDefEdgesPerFunction ??
                    DEFAULT_PDG_MAX_REACHING_DEF_EDGES_PER_FUNCTION, (message) => logger.warn(message), // unconditional — R7, both layers
                rdSolve);
                if (PROF)
                    pdgMs += performance.now() - t0;
                rdEdges += rd.edges;
                rdDropped += rd.droppedEdges;
                rdFacts += rd.facts;
                rdTruncated += rd.truncatedFunctions;
                // M5 (#2085 U5): control dependence over the SAME validated CFGs.
                // Independent of taint — runs for every `--pdg` language (post-dom +
                // Ferrante are language-agnostic, no source/sink model needed). Pure
                // compute; the bounded (controller, dependent, label) projection is
                // persisted and its time folds into the `pdg=` PROF segment next to RD.
                const tCdg = PROF ? performance.now() : 0;
                const cdg = emitFileCdg(pdgTarget, wellFormed, input.pdgMaxCdgEdgesPerFunction ?? DEFAULT_PDG_MAX_CDG_EDGES_PER_FUNCTION, (message) => logger.warn(message));
                if (PROF)
                    pdgMs += performance.now() - tCdg;
                cdgEdges += cdg.edges;
                cdgDropped += cdg.droppedEdges;
                cdgSkippedUnsound += cdg.skippedUnsoundFunctions;
                // FU-C (U-C2): RETURN-VALUE ASCENT summaries over the SAME validated
                // CFGs, inside the SAME per-file try. Independent of taint — runs for
                // EVERY `--pdg` language (pure data-dependence, no source/sink model).
                // Reuses the same RD fact cap the RD/taint solves use (coverage parity).
                const callHarvest = harvestFileCallSummaries(fnNodeIndex, wellFormed, taintLimits.maxFacts && taintLimits.maxFacts > 0
                    ? taintLimits.maxFacts
                    : DEFAULT_PDG_MAX_REACHING_DEF_FACTS_PER_FUNCTION, rdSolve);
                harvestedCallSummaries.push(...callHarvest.summaries);
                callSummaryUnresolved += callHarvest.unresolved;
                // M3 (#2083 U4): taint over the SAME validated CFGs, inside the SAME
                // per-file try (a taint throw costs this file's taint layer only —
                // its CFG/REACHING_DEF edges above are already in the graph). Skipped
                // entirely when the language has no registered model.
                if (taintSpec !== undefined) {
                    const t1 = PROF ? performance.now() : 0;
                    const taint = emitFileTaint(pdgTarget, wellFormed, pf.parsedImports, taintSpec, taintLimits, (message) => logger.warn(message), // unconditional — R4/R6
                    rdSolve);
                    if (PROF)
                        taintMs += performance.now() - t1;
                    taintTotals.analyzed += taint.functionsAnalyzed;
                    taintTotals.noMatch += taint.functionsSkippedNoMatch;
                    taintTotals.unsafeSites += taint.functionsSkippedUnsafeSites;
                    taintTotals.gapTruncated += taint.functionsCoverageGap.truncated;
                    taintTotals.gapOverflow += taint.functionsCoverageGap.overflow;
                    taintTotals.gapNoFacts += taint.functionsCoverageGap['no-facts'];
                    taintTotals.findings += taint.findingsEmitted;
                    taintTotals.kills += taint.killsEmitted;
                    taintTotals.dropped += taint.findingsDropped;
                    taintTotals.hopsTruncated += taint.hopsTruncatedFindings;
                    for (const ex of taint.coverageGapExamples) {
                        if (taintTotals.gapExamples.length < 5)
                            taintTotals.gapExamples.push(ex);
                    }
                    for (const ex of taint.droppedExamples) {
                        if (taintTotals.dropExamples.length < 5)
                            taintTotals.dropExamples.push(ex);
                    }
                    // M4 (#2084 U1): harvest per-function summaries over the SAME
                    // emit-safe CFGs, inside the SAME per-file try. Pure aside from the
                    // read-only node-index lookup; the cross-function fixpoint phase
                    // consumes `harvestedSummaries` once the whole call graph is built.
                    if (fnNodeIndex !== undefined) {
                        const harvest = harvestFileSummaries(fnNodeIndex, wellFormed, pf.parsedImports, taintSpec, 
                        // Same fact cap the taint-side RD solve uses (coverage parity).
                        taintLimits.maxFacts && taintLimits.maxFacts > 0
                            ? taintLimits.maxFacts
                            : DEFAULT_PDG_MAX_REACHING_DEF_FACTS_PER_FUNCTION, rdSolve);
                        harvestedSummaries.push(...harvest.summaries);
                        summaryUnresolved += harvest.unresolved;
                    }
                }
            }
            catch (err) {
                // Last-resort isolation, mirroring the worker-side per-file try/catch:
                // a shape the predicate misses must cost this one file's CFG, not
                // abort the language's whole scope-resolution pass mid-graph-build.
                // NOTE a mid-emit throw can leave this file's already-inserted
                // BasicBlock nodes in the graph (addNode is not transactional) —
                // orphaned but inert; the predicate keeps every JSON-representable
                // bad shape from reaching this path at all.
                logger.warn(`[cfg] ${pf.filePath}: CFG emission failed (${err instanceof Error ? err.message : String(err)}) — ` +
                    `this file's CFG is partial or absent`);
            }
        }
        if (cfgBlocks > 0) {
            logger.debug(`[scope-resolution] CFG emit (lang=${provider.language}): ` +
                `${cfgBlocks} BasicBlock nodes, ${cfgEdges} CFG edges` +
                (cfgDroppedEdges > 0 ? `, ${cfgDroppedEdges} edges dropped (per-function cap)` : '') +
                `; ${rdEdges} REACHING_DEF edges (${rdFacts} facts)` +
                (rdDropped > 0 ? `, ${rdDropped} REACHING_DEF edges dropped (per-function cap)` : '') +
                (rdTruncated > 0 ? `, ${rdTruncated} function(s) hit the fact limit` : '') +
                `; ${cdgEdges} CDG edges` +
                (cdgDropped > 0 ? `, ${cdgDropped} CDG edges dropped (per-function cap)` : '') +
                (cdgSkippedUnsound > 0
                    ? `, ${cdgSkippedUnsound} function(s) CDG-skipped (EXIT not reachable from all blocks)`
                    : '') +
                // M3 volume telemetry — only for languages with a registered model.
                (taintSpec !== undefined
                    ? `; taint: ${taintTotals.findings} TAINTED, ${taintTotals.kills} SANITIZES ` +
                        `(${taintTotals.analyzed} function(s) analyzed, ` +
                        `${taintTotals.noMatch} skipped: no source/sink match` +
                        (taintTotals.hopsTruncated > 0
                            ? `, ${taintTotals.hopsTruncated} finding(s) with truncated hop paths`
                            : '') +
                        `)`
                    : ''));
        }
        // R8 (#2195): CDG soundness skips surface UNCONDITIONALLY (parity with the
        // taint/RD gap warns) — not buried in the logger.debug stats line above. A
        // function whose EXIT is not reverse-reachable from every block gets NO
        // control dependence (an unmodeled non-terminating / multi-terminal CFG
        // shape the synthetic-escape pass could not bridge). Withholding CDG
        // silently would let a language's control dependence erode unnoticed; CFG
        // and REACHING_DEF do not depend on post-dominance and are unaffected.
        if (cdgSkippedUnsound > 0) {
            logger.warn(`[cfg] lang=${provider.language}: ${cdgSkippedUnsound} function(s) had control ` +
                `dependence skipped (EXIT not reverse-reachable from all blocks); ` +
                `CFG and REACHING_DEF are unaffected`);
        }
        // R4: taint coverage gaps and cap drops surface UNCONDITIONALLY (never
        // logger.debug, never input.onWarn) at the per-language aggregate, with
        // counts and up to 5 example functions. Per-function warns above cover
        // the rare/actionable cases (unsafe sites, cap drops); solver-status gaps
        // were already per-function-warned by the RD layer (same solver, same
        // fact cap), so this aggregate is their single taint-side surface.
        if (taintSpec !== undefined) {
            const gapCount = taintTotals.unsafeSites +
                taintTotals.gapTruncated +
                taintTotals.gapOverflow +
                taintTotals.gapNoFacts;
            if (gapCount > 0 || taintTotals.dropped > 0) {
                const parts = [];
                if (gapCount > 0) {
                    parts.push(`${gapCount} function(s) skipped for taint ` +
                        `(${taintTotals.gapTruncated} fact-limit, ${taintTotals.gapOverflow} overflow, ` +
                        `${taintTotals.gapNoFacts} no-facts, ${taintTotals.unsafeSites} malformed sites)` +
                        (taintTotals.gapExamples.length > 0
                            ? ` — e.g. ${taintTotals.gapExamples.join(', ')}`
                            : ''));
                }
                if (taintTotals.dropped > 0) {
                    parts.push(`${taintTotals.dropped} finding(s) dropped by the per-function cap` +
                        (taintTotals.dropExamples.length > 0
                            ? ` — e.g. ${taintTotals.dropExamples.join(', ')}`
                            : ''));
                }
                logger.warn(`[taint] lang=${provider.language}: ${parts.join('; ')}`);
            }
        }
        // M4 (#2084 U1): summary harvest volume + anchor-resolution diagnostics.
        if (harvestedSummaries.length > 0 || summaryUnresolved > 0) {
            logger.debug(`[taint-summary] lang=${provider.language}: ${harvestedSummaries.length} function ` +
                `summary/summaries harvested` +
                (summaryUnresolved > 0
                    ? `, ${summaryUnresolved} CFG anchor(s) unresolved (same-line collision or missing node)`
                    : ''));
        }
        // FU-C (U-C2): call-summary harvest volume + anchor-resolution diagnostics.
        if (harvestedCallSummaries.length > 0 || callSummaryUnresolved > 0) {
            logger.debug(`[call-summary] lang=${provider.language}: ${harvestedCallSummaries.length} function ` +
                `return-ascent summary/summaries harvested` +
                (callSummaryUnresolved > 0
                    ? `, ${callSummaryUnresolved} CFG anchor(s) unresolved (same-line collision or missing node)`
                    : ''));
        }
    }
    if (PROF) {
        const tEnd = process.hrtime.bigint();
        const ns = (a, b) => Number(b - a) / 1_000_000;
        logger.warn(`[scope-resolution prof] extract=${ns(tStart, tExtract).toFixed(0)}ms` +
            ` finalize=${ns(tExtract, tFinalize).toFixed(0)}ms` +
            ` propagate=${ns(tFinalize, tPropagate).toFixed(0)}ms` +
            ` rangeBind=${ns(tRangeBindStart, tPropagate).toFixed(1)}ms` +
            ` resolve=${ns(tPropagate, tResolve).toFixed(0)}ms` +
            ` emit=${ns(tResolve, tEnd).toFixed(0)}ms` +
            // pdg ⊆ emit: the M2 reaching-defs share of the emit bucket (#2082 U4).
            // taint ⊆ emit likewise: the M3 match+solve+propagate+emit share (#2083 U4).
            (input.pdg === true ? ` pdg=${pdgMs.toFixed(0)}ms taint=${taintMs.toFixed(0)}ms` : '') +
            ` total=${ns(tStart, tEnd).toFixed(0)}ms` +
            ` (${parsedFiles.length} files)`);
    }
    logHeapProbe('sr-end', `lang=${provider.language} parsedFiles=${parsedFiles.length}`);
    return {
        filesProcessed: parsedFiles.length,
        filesSkipped,
        importsEmitted,
        resolve: resolveStats,
        referenceEdgesEmitted: emitted +
            receiverExtras +
            unresolvedReceiverExtras +
            freeCallExtras +
            callableValueFlow.emitted +
            propertyDispatch.usesEmitted +
            propertyDispatch.callsEmitted,
        referenceSkipped: skipped,
        propertyDispatchSkippedKeys: propertyDispatch.skippedKeys,
        importedValueRefEdges: importedValueRefs.emitted,
        uniqueNamePropertyEdges: uniqueNameProperties.emitted,
        uniqueNamePropertyAmbiguous: uniqueNameProperties.ambiguous,
        uniqueNamePropertyNarrowed: uniqueNameProperties.narrowed,
        uniqueNamePropertyAmbiguousNames: uniqueNameProperties.ambiguousNames,
        uniqueNamePropertyCrossLanguage: uniqueNameProperties.crossLanguageOnly,
        uniqueNamePropertyCrossLanguageNames: uniqueNameProperties.crossLanguageOnlyNames,
        resolutionOutcomes,
        undecidedSatisfaction,
        functionSummaries: harvestedSummaries,
        callSummaries: harvestedCallSummaries,
    };
}
