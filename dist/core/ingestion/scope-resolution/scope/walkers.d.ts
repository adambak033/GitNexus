/**
 * Scope-chain lookup primitives shared across language providers.
 *
 * Five functions:
 *   - `findReceiverTypeBinding` — walk scope.typeBindings up the chain
 *     for a receiver name.
 *   - `lookupBindingsAt` — read finalized + augmented binding refs at
 *     one scope, deduped by `def.nodeId`. The dual-source-aware
 *     primitive every other binding lookup composes with.
 *   - `findClassBindingInScope` — walk scope.bindings + the indexes via
 *     `lookupBindingsAt` for a class-kind binding.
 *   - `findOwnedMember` — find a method/field owned by a class def
 *     across all parsed files by (ownerId, simpleName).
 *   - `findExportedDef` — find a file-level exported def (top-of-module
 *     class / function) by simpleName.
 *
 * Next-consumer contract: every OO or module-capable language hits the
 * same pre-finalize / post-finalize binding split and the same
 * "resolve member on owner with MRO" pattern. All four are reusable
 * as-is for TypeScript, Java, Kotlin, Ruby, etc.
 */
import type { BindingRef, ParsedFile, ScopeId, SymbolDefinition, TypeRef } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { SemanticModel } from '../../model/semantic-model.js';
import type { WorkspaceResolutionIndex } from '../workspace-index-types.js';
/**
 * Look up binding refs at `scopeId` for `name`, consulting both the
 * finalize-owned `bindings` channel and the post-finalize
 * `bindingAugmentations` channel (see invariant I8 in
 * `contract/scope-resolver.ts`). Finalized refs come first; augmented
 * refs append, deduped by `def.nodeId` so a sibling that's also
 * explicitly imported doesn't double-emit.
 *
 * Returns a shared frozen empty array when neither channel has the
 * name — callers can compare against `=== EMPTY_BINDINGS` if they
 * want a fast-path miss check. The bucket arrays are returned by
 * reference when only one channel populates them; the merged path
 * allocates a fresh array.
 *
 * Walker primitives (`findClassBindingInScope`,
 * `findCallableBindingInScope`, `findExportedDefByName`) and
 * post-finalize passes that read finalized bindings (e.g.
 * `propagateImportedReturnTypes`, `namespace-targets`) MUST go
 * through this helper instead of `scopes.bindings.get(...)` directly,
 * so the augmentation channel is always visible.
 */
export declare function lookupBindingsAt(scopeId: ScopeId, name: string, scopes: ScopeResolutionIndexes): readonly BindingRef[];
/**
 * Return the union of bound names at `scopeId` across both the
 * finalized and augmented channels. Companion to `lookupBindingsAt`
 * for callers that need to iterate every name at a scope (e.g.
 * `propagateImportedReturnTypes`). Order is not guaranteed; callers
 * that need stable iteration should sort externally.
 *
 * Fast paths (zero allocation) when at most one channel is populated:
 * returns the underlying `Map.keys()` iterator directly. Only when both
 * channels carry names do we materialize a `Set` for deduplication.
 *
 * Scope: enumerates only the per-scope `bindings` and `bindingAugmentations`
 * channels. It deliberately EXCLUDES the scope-independent
 * `workspaceFqnBindings` channel (PHP FQN keys, C# global-namespace simple
 * names). `lookupBindingsAt` consults that third channel when resolving a
 * specific name, but name *enumeration* here does not — those names apply at
 * every scope and would flood per-scope callers. Callers that need
 * workspace-level names must read `workspaceFqnBindings` directly.
 */
export declare function namesAtScope(scopeId: ScopeId, scopes: ScopeResolutionIndexes): Iterable<string>;
/**
 * True when a def's `type` names a class-like declaration — every kind
 * that collapses to `@scope.class` in the scope-extractor query contract.
 *
 * Semantics widened historically from `'Class' | 'Interface'` to cover
 * C#-shape languages (struct, record, enum, trait). Languages that emit
 * only `'Class'` are unaffected — the extra kinds never appear in their
 * parsed output.
 */
export declare function isClassLike(t: string): boolean;
/**
 * Does this label declare MEMBERS addressable by name?
 *
 * `isClassLike` answers two questions that only coincide for classes:
 *   1. does this declare members I can look up?  — a SHAPE (structural)
 *   2. does this participate in inheritance / MRO? — a NOMINAL TYPE
 *
 * A TypeScript object-type alias answers YES to (1) and emphatically NO to
 * (2): it declares the same `property_signature` members as the interface
 * beside it, but has no supertypes and no place in a linearization. Answering
 * (2) "yes" merely to buy (1) is what widening `isClassLike` would do, and it
 * would enrol every language's aliases (Rust `type_item`, Kotlin/Swift/Dart
 * typealias, C `typedef`) into MRO and heritage.
 *
 * So the two questions get two predicates. Use THIS one where the question is
 * "find the shape so I can look up a member"; keep `isClassLike` where the
 * question is inheritance. The call sites announce which they are:
 * `resolveInheritanceBaseInScope` and `resolveQualifiedInheritanceBase` are
 * (2); receiver typing is (1).
 *
 * NOT YET INCLUDED, deliberately: `Typedef` and `Union`. They belong here
 * conceptually — the `union_item` note on `MEMBER_OWNER_NODE_TYPES` records
 * the same gap, that a union owns fields captured as `Property` yet is not a
 * recognized owner — but neither is wired as a member container today, so
 * adding them would widen a predicate nothing exercises. They join when their
 * containers do, with fixtures.
 */
export declare function isShapeLike(t: string): boolean;
/**
 * Walk the scope chain from `startScope` looking for a typeBinding
 * named `receiverName`. Returns the TypeRef or undefined if no binding
 * exists in the chain.
 *
 * A scope that declares `ownsReceivers.has(receiverName)` terminates the
 * walk with `undefined` (#2701): it binds that receiver itself, so an
 * enclosing scope's binding is not visible through it. The check runs
 * AFTER this scope's own `typeBindings`, so a scope that both owns and
 * binds the receiver — a class method, which is where `this` is bound TO
 * the class — still resolves normally. The namespace/global fallbacks
 * below are also skipped: they answer "which type is named X", which is a
 * different question from "what is this scope's receiver", and reaching
 * them for an owned-but-unbound receiver is how a static method or a
 * detached callback acquires a fabricated one.
 */
/**
 * True when `receiverName` is DEFINITIVELY unresolvable at `startScope`:
 * a scope on the chain declares it owns that receiver (`Scope.ownsReceivers`)
 * and carries no type binding for it (#2701).
 *
 * This is a stronger statement than `findReceiverTypeBinding` returning
 * `undefined`, which only means "no type found" — an ordinary miss that later
 * passes are free to resolve by other means. Here the language has said the
 * receiver is REBOUND at this scope, so no enclosing type can be its type:
 * `this.m()` inside a nested JS/TS `function` is a call on whatever the
 * function is invoked with, which the graph does not model. A member call
 * whose receiver is unresolvable in this sense must be suppressed rather
 * than left to the receiver-blind lexical fallback in `lookupCore`, which
 * would find the enclosing class's member by name alone.
 *
 * Returns false for every language that leaves `ownsReceivers` unset.
 */
export declare function isReceiverOwnedButUnbound(startScope: ScopeId, receiverName: string, scopes: ScopeResolutionIndexes): boolean;
/**
 * True when a declaration between the call site and its module scope shadows a
 * file-level namespace import of the same name. Namespace targets are collected
 * per FILE, so every consumer of that map must apply this lexical guard before
 * trusting it at an inner scope — otherwise `def f(pkg): pkg.db.query()`
 * resolves through the import that the parameter shadows, producing a wrong
 * edge rather than a missing one.
 *
 * A namespace key may itself be a dotted import path (`pkg.db`, #2826), but the
 * name a declaration can shadow is always the ROOT identifier — `pkg = Decoy()`
 * shadows `pkg.db` too. Testing the whole dotted string would never match a
 * binding, so the guard would silently stop guarding for exactly the keys it
 * was extended to cover. Single-segment names are unaffected: their root is
 * themselves.
 *
 * Fails closed (returns `true`) on a missing scope or a parent cycle: for every
 * caller, suppressing a resolution costs a missing edge, while trusting a
 * corrupt scope chain costs a wrong one.
 *
 * Reads `scope.bindings` DIRECTLY rather than through `lookupBindingsAt`, and
 * that is deliberate — the opposite of the fix #2745 applied to Rust's
 * `headBoundLocally`. There the question was "is this name bound at all?", so
 * missing the finalized/augmented import channels lost real bindings. Here the
 * question is "does something LOCAL shadow the import?", and the import's own
 * finalized binding is the one thing that must NOT count: routing this through
 * `lookupBindingsAt` would find the namespace import shadowing itself and
 * suppress every namespace receiver in the workspace. Locals, parameters and
 * lexical names all live in the scope's own tables, which is exactly the set
 * this walk wants.
 */
export declare function isNamespaceNameShadowed(namespaceName: string, inScope: ScopeId, scopes: ScopeResolutionIndexes): boolean;
export declare function findReceiverTypeBinding(startScope: ScopeId, receiverName: string, scopes: ScopeResolutionIndexes): TypeRef | undefined;
/**
 * Resolve a typeBinding for `name` from the per-namespace channel
 * (`namespaceTypeBindings`) across the namespaces accessible from `moduleScopeId`.
 * First accessible-namespace hit wins. Returns `undefined` when the module has no
 * accessibility entry (non-module scope id, or a bundle that didn't populate the
 * channel — all non-C# today). Shared by the two typeBindings chain-walkers so
 * the named-namespace fallback stays identical between them.
 */
export declare function namespaceTypeBindingFor(moduleScopeId: ScopeId | null, name: string, scopes: ScopeResolutionIndexes): TypeRef | undefined;
/**
 * Walk the scope chain from `startScope` to its enclosing Module scope id, or
 * `null` if none is found. Used by chain-followers that need the module scope to
 * consult the accessibility-gated per-namespace channels.
 */
export declare function moduleScopeIdOf(startScope: ScopeId, scopes: ScopeResolutionIndexes): ScopeId | null;
/**
 * Look up a class-like binding by name in the given scope's chain.
 *
 * "Class-like" covers `Class | Interface | Struct | Record | Enum |
 * Trait` via the shared `isClassLike` predicate — every kind that
 * collapses to `@scope.class` in the scope-extractor query contract.
 *
 * Walks the scope chain upward and consults TWO sources at each step:
 *   1. `scope.bindings` — populated during scope-extraction Pass 2 with
 *      local declarations (`origin: 'local'`).
 *   2. The cross-file finalized + augmented bindings, via
 *      `lookupBindingsAt` (per I8: finalized = canonical immutable
 *      output; augmented = post-finalize hooks like
 *      `populateNamespaceSiblings`).
 *
 * Without (2) we'd miss every cross-file class-receiver call.
 */
/**
 * Every class-like definition visible for `name`, from the scope chain AND the
 * qualified-name index, deduped by `nodeId`.
 *
 * Exists because `walkScopeChain` returns the FIRST match and cannot report a
 * collision, so a caller that widens what a name can match (the decoration
 * normalizer below) has no way to tell "one answer" from "picked the nearest of
 * several". Mirrors `findAllCallableBindingsInScope`, which solved the same
 * problem for callables.
 */
export declare function findAllClassBindingsInScope(startScope: ScopeId, name: string, scopes: ScopeResolutionIndexes): readonly SymbolDefinition[];
/**
 * Strip one layer of type-preserving decoration off a declared type name, or
 * `undefined` when there is nothing left to strip. Supplied per language through
 * the `ScopeResolver` contract; the core never names a language (AGENTS.md R6).
 *
 * TYPE-PRESERVING only — pointer, reference, `const`, nullable, borrow,
 * deref-transparent smart pointer, sigil. A CONTAINER (array, slice, map,
 * `Option`) changes the member set, so stripping one here would type
 * `repos: Repo[]` as `Repo` and let `repos.find(x)` fold to `Repo.find`. Those
 * are unwrapped only by an index step that consumed a subscript.
 */
export type DecorationStripper = (typeName: string) => string | undefined;
/**
 * Does the scope chain at `scopeId` bind `name` as a declared TYPE PARAMETER?
 *
 * The question a class-binding lookup has to ask before it answers, because a
 * type parameter and a class are spelled identically and only the declaration
 * says which one a name is. `class Box<T> { t: T }` beside a workspace
 * `export class T` resolved `t` to the CLASS and emitted a confident wrong edge
 * from every member call on `t` — the exact failure mode this subsystem treats
 * as worse than a missing edge.
 *
 * WHY LEXICAL GROUNDING CANNOT SUBSTITUTE. The erasure grounds in
 * `resolveErasedBaseName` all ask "can the file SEE a declaration by this
 * name", and here it plainly can: `export class T` is imported, bound, and
 * lexically visible. Visibility is not the defect — the name means something
 * else at this site regardless of what else is visible, and only the enclosing
 * declaration's parameter list records that. Measured: with the grounding rule
 * in place the false edge still emitted.
 *
 * ABSENCE IS NOT EVIDENCE. `typeParameters` is populated only by the languages
 * whose captures were extended for it, and is absent both for a non-generic
 * declaration and for every declaration in a language that does not populate it
 * yet. So only a POSITIVE match declines; an absent list changes nothing, which
 * is what keeps every unconverted language behaving exactly as it does today.
 */
export declare function bindsTypeParameter(scopeId: ScopeId, name: string, scopes: ScopeResolutionIndexes): boolean;
export declare function findClassBindingInScope(startScope: ScopeId, receiverName: string, scopes: ScopeResolutionIndexes, 
/**
 * OPT-IN. When supplied, a name that binds nothing is retried with decoration
 * stripped one layer at a time, and each retry must resolve to exactly ONE
 * class-like definition or it declines.
 *
 * Opt-in rather than global because roughly two dozen call sites use the shape
 * `findClassBindingInScope(...) ?? otherResolver(...)`: turning a former
 * `undefined` into a hit SUPPRESSES the fallback that used to answer, which
 * would retarget inheritance edges and bypass generic-specialization
 * selection. Only receiver-chain base and step resolution passes this.
 */
stripDecoration?: DecorationStripper): SymbolDefinition | undefined;
/**
 * Resolve a class-like binding for a declared type name, tolerating a spelling
 * that carries TYPE ARGUMENTS (`Repo<User>`, `Vec<int>`) where the declaration
 * itself is registered under the bare base name.
 *
 * Two normalizations, and they are not the same thing:
 *
 *   1. DECORATION stripping (`stripDecoration`, opt-in — see the parameter).
 *      Peels type-PRESERVING wrappers (`*T`, `const T&`) off the name.
 *   2. Type-argument ERASURE (unconditional, and the wider of the two).
 *      `Repo<User>` → `Repo`. This is what actually widens what binds, because
 *      it makes one declaration answer for EVERY instantiation of it — right
 *      for a language where a generic class has a single declaration, and a
 *      hazard where it does not, which is why the exact-argument match runs
 *      first and why the base-name route below refuses to return a
 *      declaration that pinned its own arguments.
 *
 * Order: exact spelling → exact type-argument match (lexically visible
 * candidates first, workspace-wide index second) → base name.
 */
export declare function resolveClassBindingForName(scopeId: string, rawClassName: string, scopes: ScopeResolutionIndexes, 
/**
 * OPT-IN, and it governs (1) only — argument erasure happens either way.
 * `findClassBindingInScope`'s own docstring explains the opt-in: a name that
 * previously bound nothing starts binding, which SUPPRESSES the
 * `?? otherResolver(...)` fallbacks several callers rely on.
 *
 * THE RULE, not a roll-call of who currently passes it (that list has been
 * appended to once per round of this work and is stale the moment it is
 * written): pass it from a receiver-TYPING site, and only where the site
 * already forwarded the same `stripTypePreservingDecoration` to the bare
 * lookup — so a Go pointer receiver keeps resolving exactly as it did. A site
 * that has never stripped must keep calling without it, because starting to
 * strip is what suppresses its fallback.
 */
stripDecoration?: DecorationStripper): SymbolDefinition | undefined;
/**
 * Resolve a class-like inheritance target using the shared inheritance
 * resolution chain. Keeps pre-emitted heritage edges and language-specific
 * consumers of `inherits` sites aligned.
 */
export declare function resolveInheritanceBaseInScope(startScope: ScopeId, baseName: string, scopes: ScopeResolutionIndexes, rawQualifiedName?: string, enclosingClassDef?: SymbolDefinition): SymbolDefinition | undefined;
/**
 * Import/include-aware disambiguation for an *ambiguous* class-like base
 * name. Engages ONLY as a fallback after `findClassBindingInScope` has
 * already returned `undefined` — i.e. the scope-chain walk and the
 * single-match `qualifiedNames` fast paths could not pick a winner because
 * several same-named class-like defs exist (e.g. two `class Handler`s in
 * different headers/namespaces).
 *
 * Disambiguates by the referencing file's import graph: the enclosing
 * module scope's finalized `ImportEdge[]` (C++ `#include`, C# `using`, etc.)
 * each carry the exporting file in `targetFile`. A candidate whose defining
 * file is brought in by one of those edges is preferred. Resolution is
 * tiered, strictest first, and only commits when EXACTLY ONE candidate
 * survives a tier — so a still-ambiguous name keeps the historical
 * "return undefined" refusal:
 *
 *   1. Exact file match — candidate.filePath === an import's `targetFile`
 *      (covers C++ `#include "handler_a.h"` → that header's class).
 *   2. Same-directory match — candidate.filePath sits in the same directory
 *      as some import target file (covers C# `using MyApp.Models;`, where the
 *      namespace import resolves to ONE representative file in the namespace's
 *      directory, not necessarily the file declaring the referenced type).
 *
 * Language-neutral: keyed only on the finalized import edges and the
 * candidate defs' `filePath`. Returns `undefined` (preserving refusal) when
 * the name is single-match-resolvable already (never reached — caller gates
 * on `findClassBindingInScope` miss), when no import disambiguates, or when
 * a tier leaves more than one survivor.
 */
export declare function resolveAmbiguousInheritanceBaseViaImports(startScope: ScopeId, baseName: string, scopes: ScopeResolutionIndexes): SymbolDefinition | undefined;
/**
 * Predicate for value-receiver bridge: the labels for which
 * `reconcileOwnership` registers methods/fields under the def's
 * `nodeId` as the `ownerId`. Explicit allowlist so future NodeLabel
 * additions (Module, Namespace, TypeAlias, EnumMember, etc.) do NOT
 * silently widen the bridge — adding a new ownerable label requires
 * touching both this predicate and `reconcileOwnership`.
 *
 * See: `scope-resolution/pipeline/reconcile-ownership.ts` Property /
 * Variable / Const / Static registration block.
 */
export declare function isOwnableValueLabel(t: string): boolean;
/**
 * Look up a value-binding (Const/Variable/Property/Static) by name in
 * the given scope's chain. Used by the value-receiver-owner bridge
 * for object-literal services such as:
 *
 *   export const fooService = { getUser(id) {...} };
 *
 * where `fooService` is a `Const`/`Variable` whose `nodeId` is the
 * `ownerId` of the member method. Neither `findClassBindingInScope`
 * (rejects non-class-like) nor `findReceiverTypeBinding` (no typeBinding
 * for an unannotated literal) finds it.
 *
 * Mirrors `findClassBindingInScope` exactly; only the accepted def-type
 * predicate differs.
 */
export declare function findValueBindingInScope(startScope: ScopeId, receiverName: string, scopes: ScopeResolutionIndexes): SymbolDefinition | undefined;
/**
 * Look up a SHAPE binding (class-like, or an object-type alias) by name.
 *
 * Mirrors `findClassBindingInScope` exactly; only the accepted def-type
 * predicate differs — the same relationship `findValueBindingInScope` has to
 * it. Exists so a receiver typed as an object-type alias can reach that
 * alias's members WITHOUT the alias becoming eligible as an inheritance base:
 * `findClassBindingInScope` is what `resolveInheritanceBaseInScope` calls, so
 * widening that one would answer a question about hierarchies with a shape.
 */
export declare function findShapeBindingInScope(startScope: ScopeId, receiverName: string, scopes: ScopeResolutionIndexes): SymbolDefinition | undefined;
/**
 * Look up a callable (Function/Method/Constructor) by name in the
 * given scope's chain. Uses the dual-source pattern (scope.bindings +
 * `lookupBindingsAt` for finalized + augmented) so cross-file
 * imports are visible — without it free calls to imported functions
 * never resolve via the post-pass.
 *
 * Mirrors `findClassBindingInScope` exactly; only the accepted
 * def-type predicate differs.
 */
export declare function findCallableBindingInScope(startScope: ScopeId, callableName: string, scopes: ScopeResolutionIndexes): SymbolDefinition | undefined;
export interface CallableBindingCandidate {
    readonly def: SymbolDefinition;
    /** Every visibility path for this definition, in binding precedence order. */
    readonly bindings: readonly BindingRef[];
}
/**
 * Binding-aware callable lookup for consumers that need visibility evidence.
 * Unlike `lookupBindingsAt`, duplicate definitions retain every binding path,
 * so a weaker augmentation can contribute provenance even when a finalized
 * binding remains the candidate's canonical definition.
 */
export declare function findAllCallableBindingCandidatesInScope(startScope: ScopeId, callableName: string, scopes: ScopeResolutionIndexes): readonly CallableBindingCandidate[];
export declare function findAllCallableBindingsInScope(startScope: ScopeId, callableName: string, scopes: ScopeResolutionIndexes): readonly SymbolDefinition[];
/**
 * ISO C++ `[basic.lookup.unqual]` §7: ADL is suppressed when ordinary
 * unqualified lookup finds:
 *   - a name that is NOT a function or function template, OR
 *   - a block-scope function declaration that is NOT a using-declaration.
 *
 * Combined walker that stops at the **nearest scope** where `name` has any
 * binding (callable or non-callable) and returns:
 *   - `callables`: Function/Method/Constructor defs found at that scope
 *   - `nonCallableFound`: a non-function binding was present (variable, class, etc.)
 *   - `blockScopeDeclFound`: a callable was found at a Function or Block scope
 *     (block-scope function declaration that blocks ADL)
 *
 * One pass, one stop — no divergence between callable collection and blocker
 * detection.
 */
export declare function findCallableBindingsAndAdlBlocker(startScope: ScopeId, name: string, scopes: ScopeResolutionIndexes): {
    callables: readonly SymbolDefinition[];
    nonCallableFound: boolean;
    blockScopeDeclFound: boolean;
};
/**
 * Populate `ownerId` on every def structurally owned by a Class
 * scope — methods (defs in Function scopes whose parent is Class)
 * and class-body fields (defs directly in Class scopes).
 *
 * Generic OO ownership rule. Languages that want richer ownership
 * (e.g. inner-class qualification) can compose with this as a base
 * step.
 *
 * Mutates `parsed.localDefs` in place via type cast — `SymbolDefinition`
 * is `readonly` for consumers but the extractor returns plain objects.
 * Defs are shared by reference between `localDefs` and `Scope.ownedDefs`,
 * so this single mutation is visible from both sides.
 */
export declare function populateClassOwnedMembers(parsed: ParsedFile): void;
/**
 * Tag every def declared inside one or more `Namespace` scopes with its
 * enclosing-namespace path (`NS`, `Outer.Inner`) on a sidecar `namespacePrefix`
 * field — WITHOUT touching `qualifiedName`.
 *
 * Some scope-extractors qualify a nested type by its enclosing CLASS chain
 * (`A.Inner`) but drop the enclosing NAMESPACE, while the structure phase keys
 * the graph node by the full path (`NS.A.Inner`). `resolveDefGraphId` reads this
 * tag to retry the node lookup with the namespace-prefixed key before the
 * simple-name fallback, so same-tail nested bases don't collapse across sibling
 * namespace members (#1982). `qualifiedName` is deliberately left unchanged, so
 * the `qualifiedName`-keyed resolution index and existing namespace resolution
 * (brace-init, UDC ranking, two-phase lookup) are untouched.
 *
 * Language-agnostic: it acts only on `Namespace`-kind scopes (a namespace-free
 * language is a no-op) and is opt-in per provider (call after `populateOwners`).
 * Namespace segments are taken as each namespace def's own tail, so it composes
 * for nested namespaces regardless of whether the inner namespace's name is
 * stored simple or already dotted. Skips defs already carrying the prefix.
 */
export declare function tagNamespacePrefixes(parsed: ParsedFile, options?: {
    readonly qualifiedNamesCarryNamespace?: boolean;
}): void;
/**
 * Walk a scope chain upward looking for the innermost enclosing
 * Class scope and return that class's def. Used by per-language
 * `super` receiver branches to discover the dispatch base.
 */
export declare function findEnclosingClassDef(startScope: ScopeId, scopes: ScopeResolutionIndexes): SymbolDefinition | undefined;
/**
 * Find a free-function def by simple name across all parsed files,
 * preferring scope-chain-visible bindings (import + finalized scope
 * bindings) before falling back to a workspace-wide simple-name scan.
 *
 * The fallback scan is intentionally loose so per-language compound
 * resolvers can find a callable target even when the binding chain
 * doesn't surface it (e.g. cross-package re-exports the finalize
 * pass missed). Strictly-typed languages may want to disable the
 * fallback by simply not calling this helper from their compound
 * resolver.
 */
export declare function findExportedDefByName(name: string, inScope: ScopeId, scopes: ScopeResolutionIndexes, index: WorkspaceResolutionIndex): SymbolDefinition | undefined;
/**
 * Find a member of a class by simple name — delegates to
 * `SemanticModel.methods` (methods / functions / constructors) with a
 * fallback to `SemanticModel.fields` (properties / fields /
 * variables). After `runScopeResolution`'s reconciliation pass
 * populates both registries from `parsed.localDefs[i].ownerId`
 * (post-`populateOwners`), this is the single authoritative view of
 * class membership — no parallel scope-resolution index needed.
 *
 * Returns the first-seen overload for methods without arity or
 * return-type narrowing. Callers that need arity-aware dispatch use
 * `lookupMethodByOwner(owner, name, argCount)` directly.
 */
export declare function findOwnedMember(ownerDefId: string, memberName: string, model: SemanticModel): SymbolDefinition | undefined;
/**
 * Find a file-level def (top-of-module class / function / variable)
 * by simple name — consults the target file's Module scope's
 * finalized bindings. Only defs bound at module-scope with
 * `origin === 'local'` qualify, matching the historical
 * "module-export-visible" semantics. Class methods and class-body
 * fields bind at their containing class scope and are naturally
 * excluded.
 *
 * Reads from `WorkspaceResolutionIndex.moduleScopeByFile` (scope-tied
 * lookup that doesn't live on `SemanticModel`). This intentionally
 * does NOT call `lookupBindingsAt`: `findExportedDef` answers "what
 * did the target file declare locally at module scope?", while
 * `bindingAugmentations` models importer-side visibility created by
 * post-finalize hooks. Callers that need importer-visible exports use
 * `findExportedDefByName`, which is dual-channel aware.
 */
export declare function findExportedDef(targetFile: string, memberName: string, index: WorkspaceResolutionIndex): SymbolDefinition | undefined;
