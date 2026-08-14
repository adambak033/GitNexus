/**
 * Shared scope-tree substrate for the C-family / Go / Java / C# def/use
 * harvesters (#2197 U6, plan KTD4 — a byte-equivalent consolidation).
 *
 * The Go ({@link import('./go-harvest.js').GoHarvester}), Java ({@link
 * import('./java-harvest.js').JavaHarvester}), C# ({@link
 * import('./csharp-harvest.js').CsharpHarvester}) and C/C++ ({@link
 * import('./c-cpp-harvest.js').CCppHarvester}) harvesters each carried a
 * BYTE-IDENTICAL copy of the lexical scope tree machinery: the {@link Scope}
 * record, the binding/scope/synthetic state, the two-phase resolution cache, and
 * the `openScope` / `nearestScopeOf` / `resolve` / `def` / `use` / `conditional`
 * / `bindingTable` methods. This base holds that one copy; the four harvesters
 * extend it and supply ONLY their genuine per-language variation — the
 * `prescan` switch (abstract) and, for Go, the blank-identifier (`_`) overrides
 * of `declare` / `def` / `use`.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing): the CFG walk is NOT source-order
 * (`visitFor` builds the init block after the body, `visitDoWhile` the condition
 * before the body), so resolving names against a scope stack populated *during*
 * the walk would mis-resolve. Phase 1 (`prescan`, per-language) pre-scans the
 * whole function subtree once into a completed lexical scope tree; phase 2
 * (`resolve`) resolves defs/uses against that finished tree from any walk order.
 *
 * Identifiers with no in-function declaration (globals, fields, imports, …)
 * resolve to a SYNTHETIC module-level binding (`name@module`), created on first
 * reference and applied identically by def and use harvesting.
 *
 * NOTE: nothing serialized via the harvested bindings/facts may carry a field
 * named `nodeId` — the durable parsedfile-store reviver dedups objects keyed on
 * that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry } from '../types.js';
import { CallSiteFactAccumulator } from './call-site-harvest.js';
/**
 * The per-statement def/use + call-site collector, aliased to the shared
 * {@link CallSiteFactAccumulator} (one name for the value and the type).
 */
export type FactAccumulator = CallSiteFactAccumulator;
export interface Scope {
    readonly parent: Scope | null;
    /** name → binding index */
    readonly table: Map<string, number>;
}
/**
 * Abstract base owning the lexical scope tree + the two-phase resolution
 * substrate. Subclasses provide the per-language constructor wiring (param /
 * receiver declaration + the body `prescan` kick-off) and the abstract
 * `prescan`; Go additionally overrides `declare` / `def` / `use` for its `_`
 * blank-identifier semantics.
 */
export declare abstract class ScopeTreeHarvester {
    protected readonly fnNode: SyntaxNode;
    protected readonly bindings: BindingEntry[];
    protected readonly scopeByNode: Map<number, Scope>;
    protected readonly root: Scope;
    protected readonly synthetic: Map<string, number>;
    protected readonly fnId: number;
    /** Innermost enclosing scope per visited node id (prescan-filled) — O(scope-chain) phase-2 resolution. */
    protected readonly nearestScopeCache: Map<number, Scope>;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    protected conditionalDepth: number;
    /**
     * Call/new node id → bindings whose declaration/assignment VALUE is exactly
     * that call (#2195 U6). Registered before the value walk, consumed by the
     * language harvester's `visitCall` (mirrors the TS harvester's
     * `resultDefTargets`).
     */
    protected readonly resultDefTargets: Map<number, number[]>;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    protected openScope(node: SyntaxNode): Scope;
    protected nearestScopeOf(node: SyntaxNode): Scope;
    protected declare(nameNode: SyntaxNode, kind: BindingEntry['kind'], scope: Scope): void;
    /**
     * Phase-1 declaration pre-scan — the only genuine per-language variation (each
     * grammar has a distinct declaration-node taxonomy). Walks the function
     * subtree once, filling `nearestScopeCache` and the scope tables.
     */
    protected abstract prescan(node: SyntaxNode, scope: Scope): void;
    protected resolve(nameNode: SyntaxNode): number;
    protected def(nameNode: SyntaxNode, acc: FactAccumulator): void;
    protected use(nameNode: SyntaxNode, acc: FactAccumulator): void;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    protected conditional(fn: () => void): void;
}
