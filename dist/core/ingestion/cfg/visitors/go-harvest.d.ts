/**
 * Go def/use harvester (#2195 U5, plan KTD2) — the Go analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the closely-related
 * {@link import('./java-harvest.js').JavaHarvester} / {@link
 * import('./csharp-harvest.js').CsharpHarvester}.
 *
 * Runs in the parse worker next to the Go CFG visitor, extracting per-statement
 * variable definition/use facts that ride the side channel for the reaching-defs
 * / CDG solvers. Output is the per-function binding table ({@link BindingEntry}[])
 * plus {@link StatementFacts} the visitor attaches to blocks as it walks.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-go via the introspection probe before use (mandatory pre-step,
 * KTD5). Go shapes pre-empted (verified by a real parse):
 *  - declarations: `short_var_declaration` (`a, b := f()`, fields `left`/`right`
 *    of `expression_list`s) and `var_declaration` → `var_spec` (fields `name`*,
 *    `type`?, `value`?) [block form wraps specs in a `var_spec_list`].
 *  - assignments: `assignment_statement` (fields `left`/`operator`/`right`, all
 *    `expression_list`s; covers `=`, `+=`, multi-assign `a, b = b, a`), and
 *    `inc_statement` / `dec_statement` (`x++` / `x--`).
 *  - loop binders: `range_clause` (`for k, v := range xs`, fields `left`/`right`;
 *    the `=` reassign form and the bare `for range xs` form both parse here).
 *  - `selector_expression` (`a.b`, fields `operand`/`field`), `index_expression`
 *    (`m[k]`, fields `operand`/`index`), `parenthesized_expression`,
 *    `binary_expression` (fields `left`/`operator`/`right`), `unary_expression`
 *    (fields `operator`/`operand`; `*p` deref + `<-ch` receive).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS / Java / C#
 * harvesters): the CFG walk is NOT source-order (`visitFor` builds the init block
 * after the body, the `for`-clause condition before the update), so resolving
 * names against a scope stack populated *during* the walk would mis-resolve.
 * Phase 1 pre-scans the whole function subtree once into a completed lexical
 * scope tree; phase 2 resolves defs/uses against that finished tree from any
 * walk order.
 *
 * v1 def-semantics scope:
 *   - `short_var_declaration` `:=` — every identifier in the `left`
 *     `expression_list` is a def (`a, b := f()` defines BOTH `a` and `b`).
 *   - `var_declaration` → `var_spec` — an INITIALIZED spec (`var x = 1`,
 *     `var x int = 1`) defines each `name`; a bare `var x int` writes nothing at
 *     runtime (not a def, the TS bare-`var` rule).
 *   - `assignment_statement` (plain `=` + compound `+=` …) — each identifier in
 *     the `left` list is a def; a compound op also USES the lvalue.
 *   - `inc_statement` / `dec_statement` (`x++` / `x--`) — def AND use the lvalue.
 *   - parameters (`parameter_declaration` `name`, incl. variadic), the method
 *     receiver (`method_declaration` `receiver`), and the `range` loop variables
 *     (`range_clause` `left`).
 * EXCLUDED, deliberately (TypeScript-CFA precedent): selector / index / pointer
 * writes (`obj.f = …`, `m[k] = …`, `*p = …`) are NOT scalar defs — their root
 * identifiers are uses only. Nested-function (`func_literal`) bodies are opaque in
 * BOTH directions (writes to and reads of captured outer variables are invisible).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` — is a may-def (gen without kill), so the not-taken
 * path's prior def is not falsely killed. (Go has no ternary or `??`; assignment
 * is a statement, not an expression, so in-expression assignment defs do not
 * occur — `&&`/`||` short-circuit is the only conditional-def shape, and it can
 * only surface a may-def via a nested closure, which is opaque anyway. The
 * machinery is kept for switch/select case-test parity.)
 *
 * Identifiers with no in-function declaration (package-level vars, imported
 * names, functions) resolve to a SYNTHETIC module-level binding (`name@module`),
 * applied identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
import { CallSiteFactAccumulator } from './call-site-harvest.js';
import { ScopeTreeHarvester, type Scope, type FactAccumulator } from './scope-tree-harvest.js';
export declare class GoHarvester extends ScopeTreeHarvester {
    constructor(fnNode: SyntaxNode);
    /** The function/method/literal body node (always a `block` in Go). */
    private bodyOf;
    /** Go override: `_` is the blank identifier and binds nothing. */
    protected declare(nameNode: SyntaxNode, kind: BindingEntry['kind'], scope: Scope): void;
    /** Method receiver: `func (r *T) M()` — `r` binds at function scope. */
    private declareReceiver;
    private declareParams;
    protected prescan(node: SyntaxNode, scope: Scope): void;
    /** Declare every identifier child of an `expression_list` (LHS of `:=`). */
    private declareIdentifiers;
    /** Declare names of an INITIALIZED `var_spec` (a bare `var x int` writes nothing). */
    private declareVarDeclaration;
    /** The `var_spec` nodes of a `var_declaration` (single or `var ( … )` block). */
    private varSpecs;
    /** A `range_clause` is the `:=` short form iff it has no `=` operator token. */
    private rangeIsShort;
    /** A `receive_statement` (`case v := <-ch`) is the `:=` short form. */
    private receiveIsShort;
    private hasAnonChild;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for … range right` head: the `:=` loop vars are defs (the `=`
     * reassign form's vars are also written), and `right` is used.
     */
    rangeHeadFacts(rangeClause: SyntaxNode): StatementFacts;
    /**
     * Facts for a `switch t := i.(type)` head: `t` binds (a def) and the inspected
     * value is used.
     */
    typeSwitchHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the receiver + parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Go override: the blank identifier (`_`) defines nothing. */
    protected def(nameNode: SyntaxNode, acc: FactAccumulator): void;
    /** Go override: the blank identifier (`_`) is read of nothing. */
    protected use(nameNode: SyntaxNode, acc: FactAccumulator): void;
    /** Strip parenthesized wrappers around an lvalue (`(x) = 1`). */
    private unwrapLvalue;
    /** Def each identifier of an LHS `expression_list`; route non-identifiers to uses. */
    private defLeftList;
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    private walkValue;
    /** The single `var_spec` name when the spec declares exactly one name, else undefined. */
    private singleSpecName;
    /**
     * Register result-defs for a single-target LHS `expression_list` → RHS
     * `expression_list` whose sole element is a call. `a, b := f()` (multi-target)
     * and `x, y := f(), g()` attach nothing — the per-target mapping is ambiguous,
     * matching the TS harvester's per-declarator restriction.
     */
    private registerListResultDefs;
    /** Identifier elements of an `expression_list` (`a, b` ⇒ [a, b]). */
    private listIdentifiers;
    /** Named elements of an `expression_list` (or the node itself if not a list). */
    private listElements;
    /**
     * When `value`'s root (after stripping parens) is a call, remember its site
     * should carry `resultDefs` — the binding indices of `targets` (def-position
     * identifiers, resolved against the completed scope tree). Consumed by
     * {@link visitCall} once the value walk reaches the node.
     */
    private registerResultDefs;
    /**
     * Explicit `call_expression` handler. Records a call site (callee path,
     * receiver, per-arg occurrence entries, result defs) while reproducing EXACTLY
     * the uses the old default descent recorded (callee chain root + arguments).
     */
    private visitCall;
    /**
     * `selector_expression` chain walk shared by value position and callee
     * position. Records the chain-root identifier as a use (identical to the old
     * default descent) plus at most ONE member-read site — the INNERMOST access —
     * when the root is an identifier; `skipFinalRead` suppresses it when that
     * access is the callee (carried by the dotted path instead).
     */
    private walkChain;
}
/**
 * Ordered, deduplicating def/use + call-site collector for one statement record.
 * The shared {@link CallSiteFactAccumulator} carries the def/use machinery the
 * old local class had, plus the taint-site harvest (#2195 U6).
 */
declare const FactAccumulator: typeof CallSiteFactAccumulator;
export {};
