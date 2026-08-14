/**
 * Heritage Map
 *
 * Unified inheritance data structure built from accumulated
 * {@link ExtractedHeritage} records **after all chunks complete** (between
 * chunk processing and call resolution). Consumes `ExtractedHeritage[]` and
 * resolves type names to nodeIds via `lookupClassByName`, NOT graph-edge
 * queries.
 *
 * Combines two concerns:
 * 1. **Parent/ancestor lookup** (MRO-aware method resolution)
 * 2. **Implementor lookup** (interface dispatch — which files contain
 *    classes implementing a given interface)
 */
import type { ResolutionContext } from './resolution-context.js';
import { type SupportedLanguages } from '../../../_shared/index.js';
export interface ExtractedHeritage {
    filePath: string;
    className: string;
    parentName: string;
    /** 'extends' | 'implements' | 'trait-impl' | 'include' | 'extend' | 'prepend' */
    kind: string;
}
export interface HeritageResolutionStrategy {
    /** If set and the parent name matches, force IMPLEMENTS even when the
     *  symbol is unresolved (e.g. `/^I[A-Z]/` for C# / Java). */
    readonly interfaceNamePattern?: RegExp;
    /** Fallback edge for unresolved parents when the name pattern doesn't
     *  match (Swift uses 'IMPLEMENTS' for protocol conformance). */
    readonly defaultEdge: 'EXTENDS' | 'IMPLEMENTS';
}
/** Callback used by `buildHeritageMap` to look up the resolution strategy
 *  for a given language. Injected by callers so the model module doesn't
 *  depend on `../languages/index.js`. */
export type HeritageStrategyLookup = (lang: SupportedLanguages) => HeritageResolutionStrategy;
/**
 * Determine whether a heritage.extends capture is actually an IMPLEMENTS
 * relationship. Consults the symbol table first (authoritative — Tier 1 /
 * Tier 2 resolution); falls back to the injected {@link HeritageResolutionStrategy}
 * heuristics for external symbols not present in the graph.
 */
export declare const resolveExtendsType: (parentName: string, currentFilePath: string, ctx: ResolutionContext, strategy: HeritageResolutionStrategy) => {
    type: "EXTENDS" | "IMPLEMENTS";
    idPrefix: string;
};
/**
 * Direct parent entry with the heritage kind that produced it. Preserved
 * so kind-aware consumers (Ruby MRO, see `lookupMethodByOwnerWithMRO`) can
 * walk prepend/include providers in the correct order. Flat-string consumers
 * use `getParents` / `getAncestors` and see only the parent nodeIds.
 */
export interface ParentEntry {
    readonly parentId: string;
    /** 'extends' | 'implements' | 'trait-impl' | 'include' | 'extend' | 'prepend' */
    readonly kind: string;
}
export interface HeritageMap {
    /** Direct parents of `childNodeId` (extends + implements + trait-impl). */
    getParents(childNodeId: string): string[];
    /** Full ancestor chain (BFS, bounded depth, cycle-safe). */
    getAncestors(childNodeId: string): string[];
    /**
     * Direct parents with heritage kind preserved, insertion-ordered. Used by
     * kind-aware consumers (Ruby MRO) that need to distinguish prepend /
     * include / extend / extends for walk-order decisions.
     *
     * Insertion order mirrors the order `ExtractedHeritage` records were fed
     * into `buildHeritageMap`, which in turn mirrors tree-sitter match order.
     * For Ruby, this matches source declaration order for `prepend` / `include`
     * statements — the MRO walk reverses this (last-declared-first) at the
     * consumer side.
     */
    getParentEntries(childNodeId: string): readonly ParentEntry[];
    /**
     * Ordered ancestry for instance method dispatch (Ruby-aware): includes
     * `extends`, `implements`, `trait-impl`, `include`, `prepend` kinds.
     * Excludes `extend` (singleton-only). Order is caller-determined in Unit 3.
     * For non-Ruby callers (first-wins, c3, etc.), this matches `getAncestors`.
     */
    getInstanceAncestry(childNodeId: string): readonly ParentEntry[];
    /**
     * Ordered ancestry for singleton / class-method dispatch (Ruby-aware):
     * only `extend` kind parents. For non-Ruby languages this is always empty.
     */
    getSingletonAncestry(childNodeId: string): readonly ParentEntry[];
    /**
     * File paths of classes that directly implement or extend-as-interface the
     * given interface/abstract-class **name**. Replaces the standalone
     * `ImplementorMap` — used by interface-dispatch in call resolution.
     */
    getImplementorFiles(interfaceName: string): ReadonlySet<string>;
}
/**
 * Build a HeritageMap from accumulated ExtractedHeritage records.
 *
 * Resolves class/interface/struct/trait names to nodeIds via
 * `ctx.model.types.lookupClassByName`. When a name resolves to multiple
 * candidates, all are recorded (partial-class / cross-file scenario).
 * Unresolvable names are silently skipped — a missing parent is better
 * than a wrong edge.
 *
 * Also builds the implementor index (interface name → implementing file
 * paths) used by interface-dispatch in call resolution.
 */
export declare const buildHeritageMap: (heritage: readonly ExtractedHeritage[], ctx: ResolutionContext, getHeritageStrategy?: HeritageStrategyLookup) => HeritageMap;
