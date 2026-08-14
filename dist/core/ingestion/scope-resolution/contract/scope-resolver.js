/**
 * `ScopeResolver` — the per-language contract consumed by the generic
 * scope-resolution orchestrator (`runScopeResolution`).
 *
 * ## Migration cookbook (next language)
 *
 * To add a language to the registry-primary path:
 *
 *   1. Implement `ScopeResolver` in
 *      `gitnexus/src/core/ingestion/languages/<lang>/scope-resolver.ts`.
 *      Nine required fields (language, languageProvider,
 *      importEdgeReason, resolveImportTarget, mergeBindings,
 *      arityCompatibility, buildMro, populateOwners, isSuperReceiver)
 *      plus optional toggles / hooks:
 *        - propagatesReturnTypesAcrossImports (default true)
 *        - fieldFallbackOnMethodLookup (default true — turn OFF for
 *          statically-typed languages; the heuristic over-connects)
 *        - elementTypeOf — container element type, by subscript or accessor
 *        - collapseMemberCallsByCallerTarget — one edge per caller/target
 *        - populateNamespaceSiblings — cross-file implicit visibility
 *        - hoistTypeBindingsToModule — enable ONLY when method return
 *          types are stored on the enclosing Module scope; most
 *          languages attach them to the class scope and leave this off
 *   2. Export a thin entry point:
 *      `runYourLangScopeResolution(input) = runScopeResolution(input, yourScopeResolver)`.
 *   3. Register the provider in
 *      `gitnexus/src/core/ingestion/scope-resolution/pipeline/registry.ts`
 *      (the `SCOPE_RESOLVERS` map). That registration is all it takes — the
 *      `scopeResolutionPhase` runs every registered resolver.
 *   4. Verify the resolver integration test at
 *      `gitnexus/test/integration/resolvers/<lang>.test.ts` passes (it runs
 *      in the standard test suite). Scope-resolution is the only resolution
 *      path — the legacy call-resolution DAG was removed in RING4-1 #942.
 *
 * No new pipeline phase, no orchestrator copy-paste, no workflow
 * change. The generic `scopeResolutionPhase` auto-discovers everything via
 * the `SCOPE_RESOLVERS` map.
 *
 * ## ScopeResolver vs LanguageProvider
 *
 * The codebase has two provider contracts. Their lifecycles differ:
 *
 *   - `LanguageProvider` (`language-provider.ts`) is the
 *     **parsing-side** contract — how to emit captures, classify
 *     scopes, interpret imports / typeBindings. ~40 fields covering
 *     both legacy and new pipelines. Consumed by `ScopeExtractor`,
 *     once per file at extract time.
 *   - `ScopeResolver` (this file) is the **emit-side** contract — how
 *     the resolution pipeline dispatches references to graph edges.
 *     8 fields total. Consumed by `runScopeResolution`, once per
 *     workspace at resolve time.
 *
 * They share three concept names (`arityCompatibility`, `mergeBindings`,
 * `resolveImportTarget`) because the emit pipeline reuses a few
 * finalize hooks. Per-language wiring passes the SAME function
 * reference through both interfaces — no second copy of the logic.
 * Rationale for not collapsing: lifecycle separation, and merging
 * would create a god-interface complicating future migrations.
 *
 * ## Reference implementation
 *
 * `gitnexus/src/core/ingestion/languages/python/scope-resolver.ts` —
 * `pythonScopeResolver` is the canonical example. Read that file when
 * migrating a new language; this interface lists the fields that
 * implementation populates.
 *
 * ## Contract Invariants the orchestrator depends on
 *
 * These are non-obvious behaviors that the orchestrator and the
 * existing Python + C# resolvers depend on. Future implementers will
 * break them silently if not documented.
 *
 *   - **I1 — Phase 4 emission order is load-bearing.** `emitReceiverBoundCalls`
 *     runs FIRST (populates `handledSites`), then `emitFreeCallFallback`,
 *     then `emitReferencesViaLookup` (consumes `handledSites` as a skip
 *     set), then `emitImportEdges`. Reordering breaks same-name collision
 *     resolution: the shared lookup can mis-resolve `app_metrics.get_metrics()`
 *     to a same-named local function, and only the precise per-receiver
 *     pass running first prevents the wrong edge.
 *
 *   - **I2 — `handledSites` semantics.** A site is added to
 *     `handledSites` IFF a `tryEmitEdge` call returned `true` for it.
 *     Sites a pass touched but couldn't resolve do NOT get marked —
 *     they still get a chance from the shared resolver. Exception:
 *     the free-call fallback marks the site unconditionally after
 *     attempting emission (even on dedup-collapse), because the
 *     per-(caller, target) collapse semantics require multiple call
 *     sites in the same caller body not produce multiple edges.
 *     `preEmitInheritanceEdges` also pre-marks every `inherits` site so
 *     the generic bridge cannot remap class heritage into method-owned
 *     EXTENDS edges via `resolveCallerGraphId`.
 *
 *   - **I3 — `propagateImportedReturnTypes` mutation timing + ordering.**
 *     The pass mutates `Scope.typeBindings` (a plain `new Map(...)` from
 *     `draftToScope`, NOT frozen). It MUST run AFTER `finalizeScopeModel`
 *     (so `indexes.bindings` is populated) and BEFORE
 *     `resolveReferenceSites` (so resolution sees the propagated types).
 *     The pass also re-runs `followChainPostFinalize` on every scope's
 *     typeBindings because scope-extractor's pass-4 already ran and
 *     missed any chain whose terminal lives in a foreign file.
 *     Within the pass, files are walked in `indexes.sccs` reverse-
 *     topological order (leaves first) so multi-hop alias chains
 *     (e.g. `models.User → service.user → app.user`) collapse to the
 *     terminal class in a single pass — every importer sees its
 *     source's already-chain-followed typeBindings. Cyclic SCCs reach
 *     a partial fixpoint within a single pass without iterating to
 *     convergence; `ts-circular` only asserts pipeline-no-throw.
 *
 *   - **I4 — `emitReceiverBoundCalls` case order.** Cases are evaluated
 *     in this order; the FIRST that emits an edge wins:
 *       1. super branch (`provider.isSuperReceiver(receiverName)`)
 *       2. Case 0 compound (`receiverName` has `.` or `(`)
 *       3. Case 0.5 implicit-`this` chain walk — GATED: fires only for
 *          languages that set `resolveThisViaEnclosingClass === true`;
 *          it intercepts every bare-`this` call/read/write site ahead of
 *          Case 4 and does NOT emit the interface-dispatch fan-out that
 *          Cases 0, 3b and 4 all perform (Case 0 gained it in #2829 and
 *          Case 3b in #2832, leaving 0.5 the only INSTANCE-receiver case
 *          that folds or walks to a receiver type without fanning out.
 *          Read that narrowly: Case 2 also walks an MRO and its binding
 *          admits `Interface`, but its receiver IS the type name, so the
 *          site is static dispatch and a fan-out would be wrong; Cases 3
 *          and 5 resolve by direct lookup rather than a fold or MRO walk,
 *          and no language is known to reach Case 3 with an Interface —
 *          every one that could strips the namespace qualifier first,
 *          sending it to Case 4), so enabling the toggle
 *          for a language changes that language's `this` dispatch
 *          semantics (see the toggle's doc below)
 *       4. Case 1 namespace-receiver
 *       5. Case 2 class-name receiver
 *       6. Case 3 dotted typeBinding for namespace prefix
 *       7. Case 3b chain-typebinding (compound resolver + interface-dispatch
 *          fan-out on an Interface fold, #2832)
 *       8. Case 4 simple typeBinding (MRO walk + findOwnedMember)
 *     Reordering or merging cases changes resolution semantics. The
 *     numbering is part of the contract — keep the comments.
 *
 *   - **I5 — Pre-seeding `seen` from `referenceIndex` is forbidden.**
 *     Earlier versions of the receiver-bound pass pre-populated `seen`
 *     to avoid double-emit. After Phase 4 was reordered, pre-seeding
 *     became actively harmful: it suppresses correct emissions for
 *     sites the shared resolver happened to resolve to a wrong target.
 *     The orchestrator MUST NOT pre-seed.
 *
 *   - **I6 — `Scope.typeBindings` is mutable post-finalize.** `draftToScope`
 *     (in `scope-extractor.ts`) builds `typeBindings` as a plain
 *     `new Map(...)` — not frozen, intentionally. Passes below rely on
 *     this. Do NOT freeze `typeBindings` in any downstream refactor.
 *
 *   - **I7 — `ScopeResolver` and `LanguageProvider` are distinct contracts.**
 *     Python and C# pass the SAME function reference through both
 *     interfaces where they share a hook name — no second copy of the
 *     logic. Rationale for not collapsing them: lifecycles differ
 *     (parsing-side runs once per file at extract time, emit-side runs
 *     once per workspace at resolve time), and merging would create a
 *     god-interface that complicates future migrations.
 *
 *   - **I8 — Binding-channel lifecycle.** Post-finalize binding lookup
 *     fans across several channels (`lookupBindingsAt` /
 *     `findReceiverTypeBinding` consult them in precedence order):
 *     `indexes.bindings` (frozen finalize output), `Scope.bindings`
 *     (lexical local, first-tier shadowing), `indexes.bindingAugmentations`
 *     (per-scope append-only), `indexes.workspaceFqnBindings` +
 *     `indexes.workspaceTypeBindings` (scope-independent / global, consulted
 *     unconditionally), and `indexes.namespaceFqnBindings` +
 *     `indexes.namespaceTypeBindings` (per-namespace, consulted only for the
 *     namespaces in `indexes.accessibleNamespacesByScope` for the caller's
 *     module). All but `indexes.bindings` are mutable post-finalize and
 *     populated by hooks; only `indexes.bindings` is frozen.
 *
 *     `indexes.bindings` is the **finalize-output channel**. After
 *     `finalizeScopeModel` returns, its inner `BindingRef[]` arrays
 *     are deep-frozen by `materializeBindings` and MUST NOT be
 *     mutated by any post-finalize hook. Treat `indexes.bindings` as
 *     immutable from the moment `finalizeScopeModel` returns.
 *
 *     `indexes.bindingAugmentations` is the **post-finalize
 *     append-only channel**. Hooks like `populateNamespaceSiblings`
 *     append cross-file bindings synthesized after finalize (C#
 *     same-namespace visibility, `using static` member exposure)
 *     into this channel, NOT into `indexes.bindings`. Inner arrays
 *     here are NEVER frozen — hooks `push()` directly. Any consumer
 *     that reads post-finalize workspace bindings MUST query both
 *     index channels via `lookupBindingsAt`
 *     (`scope-resolution/scope/walkers.ts`); the helper returns
 *     finalized refs first, appends unique augmentation refs after,
 *     and dedupes by `def.nodeId` so finalized metadata wins on
 *     duplicate defs. Per-`Scope.bindings` local declarations are the
 *     lexical extraction channel and remain a separate first-tier
 *     lookup for local shadowing.
 *
 *     `Scope.typeBindings` remains mutable post-finalize per I6 (it
 *     is intentionally not frozen at any point).
 *
 *     The `ReadonlyMap<...>` types on `ScopeResolutionIndexes` are
 *     compile-time read-guidance for consumers; structural mutation
 *     of `bindingAugmentations` is performed via a deliberate
 *     `as Map<...>` cast inside the hook implementations and is the
 *     ONLY sanctioned channel for post-finalize binding fanout.
 *
 *     The dev-mode runtime validator
 *     (`validateBindingsImmutability` in
 *     `scope-resolution/validate-bindings-immutability.ts`) surfaces
 *     any drift — i.e. a hook writing to `indexes.bindings` instead
 *     of `bindingAugmentations`, or producing a non-frozen finalized
 *     bucket — via `onWarn` when explicitly enabled by
 *     `NODE_ENV === 'development' || VALIDATE_SEMANTIC_MODEL === '1'`
 *     (`VALIDATE_SEMANTIC_MODEL=0` is an explicit off switch).
 *
 *   - **I9 — `SemanticModel` is the single authoritative symbol store.**
 *     Every symbol-indexed lookup (key = `nodeId | simpleName |
 *     qualifiedName | filePath`) resolves through
 *     `SemanticModel.{symbols,types,methods,fields}`. Scope-resolution
 *     passes MUST NOT maintain parallel owner-keyed or name-keyed
 *     symbol indexes — `WorkspaceResolutionIndex` is reserved for
 *     `Scope`-valued lookups that `SemanticModel` structurally cannot
 *     carry.
 *
 *     The `runScopeResolution` orchestrator guarantees this invariant
 *     in two steps:
 *       1. The legacy `parse` phase populates `SemanticModel` via
 *          `symbolTable.add(...)`. For languages whose extractor
 *          resolves `enclosingClassId` at parse time, class-body defs
 *          are correctly owner-keyed there.
 *       2. The `reconcileOwnership` pass runs after
 *          `provider.populateOwners(parsed)` and registers any def in
 *          `parsed.localDefs[i]` with a corrected `ownerId` that the
 *          legacy pass missed (primarily Python class-body methods).
 *          Idempotent — duplicates are skipped by `nodeId`.
 *
 *     Contract for consumers: `model` is `MutableSemanticModel` only
 *     during those two write phases. Downstream passes receive a
 *     narrowed `SemanticModel` (read-only) handle. This is enforced by
 *     `runScopeResolution`'s type-level narrowing at the phase
 *     boundary.
 *
 *     The dev-mode runtime validator (`validateOwnershipParity`)
 *     surfaces any drift between `parsed.localDefs` ownership and the
 *     registries via `onWarn` when
 *     `NODE_ENV !== 'production' && VALIDATE_SEMANTIC_MODEL !== '0'`.
 *
 *     This invariant is a **transitional shim**: the architectural
 *     end state is for every language's parse-time extractor to emit
 *     the correct `ownerId` directly, removing the need for
 *     reconciliation. Tracked as a follow-up; see ARCHITECTURE.md §
 *     "Semantic-model source of truth".
 *
 * ## Semantic-model source of truth
 *
 * `ParsedFile` (from `gitnexus-shared/src/scope-resolution/parsed-file.ts`)
 * is the single semantic model consumed by both the legacy DAG and the
 * scope-resolution pipeline. Scope-resolution passes MUST NOT build a
 * parallel parse representation; if a pass needs AST-level facts that
 * `ParsedFile` doesn't expose, it should reuse the orchestrator's
 * `treeCache` (see `RunScopeResolutionInput.treeCache`) rather than
 * re-invoke `parser.parse(...)` on its own.
 *
 * ## Same-graph guarantee
 *
 * Edges emitted by `runScopeResolution` and edges emitted by the legacy
 * DAG are indistinguishable to downstream consumers:
 *   - Node identity: same `generateId(...)` helper, same qualified-name
 *     keyspace, same File/Folder/Method/Class node labels.
 *   - Edge vocabulary: `'import-resolved' | 'global' | 'local-call' |
 *     'same-file' | 'interface-dispatch' | 'read' | 'write'` — both
 *     paths emit the same reasons (see
 *     `gitnexus/src/core/ingestion/call-processor.ts` for the legacy
 *     emitter and `passes/receiver-bound-calls.ts` /
 *     `passes/free-call-fallback.ts` for the scope-resolution emitters).
 *   - Overload disambiguation: both paths use
 *     `generateId('Method', ...)` suffixed with `parameterTypes` when a
 *     method has overloads — see `graph-bridge/ids.ts`.
 *
 * The CI parity workflow (`.github/workflows/ci-scope-parity.yml`)
 * runs both paths on every migrated language's fixture corpus and
 * fails if the graph outputs diverge.
 *
 * Plan that introduced most of these invariants:
 * `docs/plans/2026-04-20-001-refactor-emit-pipeline-generalization-plan.md`.
 */
export {};
