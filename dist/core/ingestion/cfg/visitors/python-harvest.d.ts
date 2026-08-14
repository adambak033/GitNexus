/**
 * Python def/use harvester — the Python analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the C-family
 * harvesters ({@link import('./go-harvest.js').GoHarvester} et al.). Python is
 * the most structurally divergent CFG target (indentation blocks, no braces,
 * comprehensions, `with`, `try/except/else/finally`, `match/case`), so this
 * harvester exercises the shared reaching-defs / CDG substrate against a grammar
 * with none of the brace-family assumptions.
 *
 * Runs in the parse worker next to the Python CFG visitor, extracting
 * per-statement variable definition/use facts that ride the side channel for the
 * reaching-defs / CDG solvers. Output is the per-function binding table
 * ({@link BindingEntry}[]) plus {@link StatementFacts} the visitor attaches to
 * blocks as it walks. Each `call` ALSO records a taint {@link SiteRecord} (callee
 * path, receiver, per-arg occurrence entries, result defs, spread marker, and an
 * `at` anchor) via the shared {@link CallSiteFactAccumulator} — the same site
 * substrate the C-family / Go / TS harvesters emit. Python has NO `new`
 * expression (constructors are plain `call`s), so every site is `kind: 'call'`.
 * The `at` anchor is the `call` node's start position, byte-aligned with the
 * `@reference.call.*` CALLS-edge anchor (which also captures the whole `call`
 * node), so the downstream resolved-callee-id join lands by exact position.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-python (0.23.x) via the introspection probe before use (mandatory
 * pre-step). Python shapes pre-empted (verified by a real parse):
 *  - functions: `function_definition` (fields `name`/`parameters`/`body`; async
 *    is the SAME node with an `async` token child) and `lambda` (fields
 *    `parameters`=`lambda_parameters`, `body`).
 *  - parameters: bare `identifier`, `default_parameter` (fields `name`/`value`),
 *    `typed_parameter` (no `name` field — the binder is a named child:
 *    `identifier` / `list_splat_pattern` / `dictionary_splat_pattern`),
 *    `typed_default_parameter` (fields `name`/`type`/`value`),
 *    `list_splat_pattern` (`*args`), `dictionary_splat_pattern` (`**kwargs`).
 *  - assignment targets: `assignment` (fields `left`/`right`/optional `type`;
 *    LHS may be `identifier`, `pattern_list`, `tuple_pattern`, `list_pattern`,
 *    `attribute`, or `subscript`), `augmented_assignment` (fields
 *    `left`/`operator`/`right` — read+write), `named_expression` walrus (fields
 *    `name`/`value`).
 *  - unpacking patterns: `pattern_list` / `tuple_pattern` / `list_pattern`
 *    nest `identifier` and `list_splat_pattern` (`*rest`) targets.
 *  - binders: `for_statement` (fields `left`/`right`), `for_in_clause`
 *    (comprehension binder, fields `left`/`right`), `with_item` (field `value`
 *    = `as_pattern` whose `alias`=`as_pattern_target`, or a bare expression),
 *    `except_clause` / `except_group_clause` (`as_pattern` → `as_pattern_target`),
 *    `global_statement` / `nonlocal_statement` (identifier children).
 *  - reads: `attribute` (fields `object`/`attribute`), `subscript` (fields
 *    `value`/`subscript`), `call` (fields `function`/`arguments`),
 *    `boolean_operator` (fields `left`/`operator`/`right`),
 *    `conditional_expression` (ternary: consequent / condition / alternative in
 *    source order), `parenthesized_expression`.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS / Go harvesters):
 * the CFG walk is NOT source-order, so resolving names against a scope stack
 * populated *during* the walk would mis-resolve. Phase 1 pre-scans the whole
 * function subtree once, declaring every in-function name (Python's def-on-first-
 * assignment scoping has a SINGLE function scope — there is no block scope, so
 * the whole function body shares one table). Phase 2 resolves defs/uses against
 * that finished table from any walk order.
 *
 * Python scope model (deliberately simplified, documented): Python binds names
 * at FUNCTION scope on first assignment anywhere in the body (no block scope).
 * We therefore declare all assignment / for / with / except / walrus /
 * comprehension targets and parameters into the single function table.
 * `global x` / `nonlocal x` names are recorded as SYNTHETIC module-level
 * bindings (`name@module`) so their writes/reads share one binding with the
 * outer scope rather than minting a confusing function-local. Comprehension
 * targets technically have their OWN scope in Py3 (a leaked `i` after `[i for
 * i in xs]` does NOT exist), but we declare them in the function table anyway —
 * a documented over-approximation that keeps the comprehension target a real
 * def (the plan's explicit ask) without modeling nested comprehension scopes.
 *
 * v1 def-semantics scope:
 *   - `assignment` plain `=` — each identifier target in the (possibly nested)
 *     LHS pattern is a def; a `*rest` splat target is a def; an `attribute` /
 *     `subscript` target is NOT a scalar def (its root identifier is a use).
 *   - `augmented_assignment` (`x += 1`) — def AND use the lvalue.
 *   - `named_expression` walrus (`(n := f())`) — `n` is a def.
 *   - `for_statement` / `for_in_clause` `left` — loop/comprehension targets are
 *     defs; `right` is a use.
 *   - `with_item` `as` alias (`with cm as fh`) — `fh` is a def.
 *   - `except ... as e` — `e` is a `catch`-kind def (matters to the taint pass).
 *   - parameters (incl. defaults, `*args`, `**kwargs`, typed) — `param`-kind defs.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): attribute / subscript
 * writes (`obj.f = …`, `arr[i] = …`) are NOT scalar defs — their root
 * identifiers are uses only. Nested function (`function_definition` / `lambda`)
 * bodies are opaque in BOTH directions (reads of and writes to captured outer
 * variables are invisible — callback flows are later-pass territory).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression is a may-def
 * (gen WITHOUT kill), so the not-taken path's prior def is not falsely killed.
 * Python's conditional-def shapes: a walrus in the right operand of `or` / `and`
 * short-circuit (`a or (x := b)`), a walrus in either non-test arm of a ternary
 * (`(a := p) if c else (b := q)`), and a `case`-clause guard / pattern test.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class PythonHarvester {
    private readonly fnNode;
    private readonly bindings;
    /** Single function-scope name → binding index (Python has no block scope). */
    private readonly table;
    private readonly synthetic;
    /** Names declared `global`/`nonlocal` — resolve to the synthetic module binding. */
    private readonly globalNames;
    private readonly fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    private conditionalDepth;
    /**
     * `call` node id → binding indices its result is assigned to (`x = f()` ⇒
     * `[x]`, `a, b = f()` ⇒ `[a, b]`). Populated just before the value walk reaches
     * the call (see {@link registerResultDefs}) and consumed by {@link visitCall}.
     * Mirrors the Go harvester's `resultDefTargets`.
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The function/lambda body node (a `block` for `def`, an expression for `lambda`). */
    private bodyOf;
    private declare;
    /** Declare every parameter binder (incl. defaults, typed, `*args`, `**kwargs`). */
    private declareParams;
    /** Declare the binder identifier(s) of one parameter node. */
    private declareParam;
    /** Declare a binder that may be an identifier or a `*`/`**` splat pattern. */
    private declareParamBinder;
    /**
     * Pre-scan the function body once, declaring every in-function name. Recurses
     * into compound statements but NOT into nested `function_definition` / `lambda`
     * bodies (opaque). `global`/`nonlocal` are processed FIRST in a sibling sweep
     * so a later assignment to a global name does not mint a function-local.
     */
    private prescan;
    /** Declare identifier/splat leaves of an assignment / loop target pattern. */
    private declareTargets;
    /** `with EXPR as TARGET` — declare the alias target(s). */
    private declareWithItem;
    /** `except E as e` — declare `e`. */
    private declareExceptAlias;
    /** The `as_pattern_target` child of an `as_pattern` (when no `alias` field). */
    private asPatternTarget;
    /** Declare an `as_pattern_target` (or its identifier child) as a binding. */
    private declareAsTarget;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for TARGET in ITER` / `for_in_clause` head: the loop target(s)
     * are defs, the iterated expression is a use.
     */
    loopHeadFacts(headNode: SyntaxNode): StatementFacts;
    /** Facts for a `with_item`: the `as` alias is a def, the value an use. */
    withItemFacts(item: SyntaxNode): StatementFacts;
    /** Facts for an `except E as e:` header: `e` is a def, `E` a use. */
    exceptHeadFacts(clause: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the parameters (defs only — incl. default-value uses). */
    paramFacts(): StatementFacts | undefined;
    /** Def the binder(s) of one parameter node and use any default-value expr. */
    private defParam;
    private defParamBinder;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /**
     * Def each identifier/splat leaf of an assignment / loop target pattern; route
     * attribute / subscript targets to the value walk (root identifier is a use).
     */
    private defTargets;
    /** Def an `as_pattern_target` (or its identifier child). */
    private defAsTarget;
    /** Value-position walk: collect uses; route def positions to the target handler. */
    private walkValue;
    /**
     * A comprehension (`[body for t in src if g]`): each `for_in_clause` target is
     * a def, its source a use; the `body` and any `if_clause` are uses. Kept INLINE
     * (no separate CFG blocks) per the plan — the target binding is harvested so it
     * is a real def. The `for_in_clause` source is walked in the ENCLOSING context
     * (it reads outer names), the body/filter after the targets are bound.
     */
    private walkComprehension;
    /** Binding indices assigned by a target pattern, without mutating statement facts. */
    private targetDefIndices;
    /** Record result defs for a call-valued assignment. */
    private registerResultDefs;
    /** Strip `parenthesized_expression` wrappers around a value (`(f())`). */
    private unwrapValue;
    /**
     * Explicit `call` handler. Records a call site (callee path, receiver, per-arg
     * occurrence entries, result defs, spread marker) while reproducing EXACTLY
     * the uses the old default descent recorded (callee chain root + arguments).
     * Python has no `new` — every site is `kind: 'call'`.
     */
    private visitCall;
    /** Walk arguments, assigning only positional values to positional sink slots. */
    private walkArgs;
    /**
     * `attribute` chain walk shared by value position and callee position. Records
     * the chain-root identifier as a use (identical to the old default descent)
     * plus at most ONE member-read site — the INNERMOST access — when the root is
     * an identifier; `skipFinalRead` suppresses it when that access is the callee
     * (carried by the dotted path instead). Mirrors the Go harvester's `walkChain`.
     */
    private walkChain;
}
