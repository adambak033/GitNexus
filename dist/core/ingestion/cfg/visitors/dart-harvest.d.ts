/**
 * Dart def/use harvester (#2195) — the Dart analogue of
 * {@link import('./python-harvest.js').PythonHarvester} and the C-family
 * harvesters. Like Python it harvests per-function binding tables
 * ({@link BindingEntry}[]) plus {@link StatementFacts} (defs / uses / mayDefs)
 * AND a taint {@link import('../types.js').SiteRecord} per call / `new` (callee
 * path, receiver, per-arg occurrence entries, result defs, spread marker, and an
 * `at` anchor) via the shared {@link CallSiteFactAccumulator} — the same site
 * substrate the C-family / Go / TS / Python harvesters emit.
 *
 * DART HAS NO `call_expression` NODE (verified by a real parse — see below). A
 * call is a FLAT SIBLING RUN under a container (`expression_statement`,
 * `argument`, an `initialized_variable_definition`'s `value` field,
 * `await_expression`, …): a chain HEAD (`identifier` / `this` / `super` / a
 * parenthesized expr) immediately followed by one or more `selector` siblings.
 * A `selector` whose inner is an `argument_part` is the CALL marker (the prefix
 * up to it is the callee); a `selector` whose inner is an
 * `unconditional_assignable_selector` / `conditional_assignable_selector`
 * (`.name` / `?.name`) is a member access. So `foo(a, b)` parses as
 * `identifier foo` + `selector (a, b)`; `obj.method(x)` as `identifier obj` +
 * `selector .method` + `selector (x)`; `a.b.c()` as `a` + `.b` + `.c` + `()`.
 * A `new Foo(…)` IS a single `new_expression` node (`type_identifier` +
 * `arguments`) — the only `kind: 'new'` shape. An UpperCamelCase bare call
 * `Foo(…)` is an IMPLICIT constructor by Dart convention but is structurally a
 * free call (`identifier` + `selector(argument_part)`), so it stays
 * `kind: 'call'` (matching the scope-extractor, which tags it
 * `@reference.call.constructor` on the same callee identifier — see below).
 *
 * ANCHOR ALIGNMENT (plan KTD7 — load-bearing): a call site's `at` MUST be the
 * SAME `[line (1-based), col (0-based)]` the Dart CALLS resolution keys its
 * `atRange` on, because a downstream unit joins the two by EXACT position. Dart
 * has no whole-call node, so the scope-extractor anchors the CALLS reference NOT
 * on a call expression but on the callee NAME identifier
 * (`captures.ts emitSelectorReference`):
 *   - a FREE / implicit-constructor call `foo(…)` / `Foo(…)` →
 *     `@reference.call.free` / `.constructor` anchored on the callee `identifier`
 *     (`prev`), so `at` = that identifier's start.
 *   - a MEMBER call `obj.method(…)` → `@reference.call.member` anchored on the
 *     method-name `identifier` (`nameId`, inside the `.method` selector), so
 *     `at` = the method-name identifier's start — NOT the receiver `obj`.
 * (A `new_expression` is NOT captured for CALLS by the Dart scope-resolution
 * today, so a `new` site's `at` simply finds no resolved id — graceful, never a
 * mis-join. A cascade `a..m(…)` resolves as a FREE call on its method name.)
 *
 * Runs in the parse worker next to the Dart CFG visitor. Output is the binding
 * table the {@link import('../cfg-builder.js').CfgBuilder} stamps onto the CFG,
 * plus the per-block def/use facts the reaching-defs / CDG solvers consume.
 *
 * Every node-type literal below was grammar-validated against the VENDORED
 * tree-sitter-dart via the introspection probe before use (mandatory pre-step —
 * the grammar-literal CI gate maps `dart-harvest.ts → Dart` and fails on a wrong
 * literal). Dart's grammar splits a function into SIBLING nodes — a
 * `function_signature` / `method_signature` / getter/setter signature followed by
 * a sibling `function_body` (the body, NOT a child of the signature) — so this
 * harvester takes the `function_body` (or a closure's `function_expression`) as
 * the function node and reaches the signature via the previous sibling.
 *
 * Dart shapes pre-empted (verified by a real parse):
 *  - parameters: `function_signature`/`method_signature`/`setter_signature` own a
 *    `formal_parameter_list` → `formal_parameter` (each `name:identifier`). A
 *    closure (`function_expression`) owns `parameters:formal_parameter_list`.
 *  - `local_variable_declaration` → `initialized_variable_definition`
 *    (`name:identifier` `= value`). The declaration kind keyword is `inferred_type`
 *    (`var`), `final_builtin` (`final`), a `type_identifier`/`void_type` (typed),
 *    or `late` (anon). A bare `var e;` with no initializer still binds the name.
 *  - `for_loop_parts` — C-style (`init:local_variable_declaration`,
 *    `condition:`, `update:`) OR for-in (`inferred_type`? `name:identifier` `in`
 *    `value:` — or a bare `identifier` `in` `value:` over an existing variable).
 *  - `catch_clause` → `catch_parameters` (`(e)` or `(e, st)` — both bound).
 *  - reads: `identifier`, `selector` (`.name` / `(...args)` member/call chain),
 *    `assignment_expression` (`left:assignable_expression` `operator:` `right:`),
 *    `if_null_expression` (`a ?? b`), `conditional_expression` (`c ? a : b`),
 *    logical `&&` / `||` (`logical_and_expression` / `logical_or_expression`).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the Kotlin / Swift / Rust
 * harvesters): the CFG walk is NOT source-order (`do … while` builds the condition
 * after the body), so resolving names against a scope stack populated *during* the
 * walk would mis-resolve. Phase 1 pre-scans the whole function subtree once,
 * declaring every bound name into ONE function table; phase 2 resolves defs/uses
 * against that finished table from any walk order. Dart DOES have block scope +
 * shadowing, but a single function table is the documented v1 simplification used
 * by the Kotlin / Swift / Python / Rust harvesters — distinct shadowing
 * redeclarations of the same name collapse onto one binding (an over-approximation
 * that can falsely kill across a shadow, the sound direction for taint).
 *
 * v1 def-semantics scope:
 *   - `initialized_variable_definition` (`var`/`final`/typed `PAT = …`) — the
 *     `name:identifier` is a def; the value is walked for uses. A bare declaration
 *     with no initializer still binds the name (Dart locals are in scope from the
 *     declaration; an uninitialized read is a compile error, so binding is safe).
 *   - `assignment_expression` plain `=` — a plain-identifier lvalue is a def; a
 *     member / subscript target (`this.x = …`, `a[i] = …`) is NOT a scalar def
 *     (its root is a use). A compound `+=`/`-=`/… target def-AND-uses the lvalue.
 *   - `postfix_expression` / `prefix_expression` update (`i++` / `--i`) def-and-use.
 *   - `for (var e in xs)` — the loop pattern name is a def, the collection a use.
 *   - `catch (e, st)` — both error binders bind.
 *   - parameters (incl. closure params) are `param`-kind defs.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): member / subscript writes
 * (`obj.f = …`, `a[i] = …`) are NOT scalar defs — their root identifiers are uses
 * only. Nested-function bodies (`function_expression`) are opaque in BOTH directions.
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` short-circuit, the `??` right operand, a conditional
 * (`? :`) arm, and a `switch`-expression / case-pattern test — is a may-def (gen
 * WITHOUT kill), so the not-taken path's prior def is not falsely killed.
 *
 * Identifiers with no in-function declaration (top-level functions, types,
 * fields) resolve to a SYNTHETIC module-level binding (`name@module`), applied
 * identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class DartHarvester {
    private readonly fnNode;
    private readonly signature;
    private readonly bindings;
    /** Single function-scope name → binding index (v1: no block scope). */
    private readonly table;
    private readonly synthetic;
    private readonly fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    private conditionalDepth;
    /**
     * Chain-head / `new_expression` node id → binding indices its single-target
     * result is assigned to (`var x = f()` / `x = g()` ⇒ `[x]`). Populated just
     * before the value walk reaches the call (see {@link registerResultDefs}) and
     * consumed by {@link visitChainCall} / {@link visitNew}. Mirrors the Python /
     * Go harvesters' `resultDefTargets`.
     */
    private readonly resultDefTargets;
    /**
     * @param fnNode  The function-bearing node: a `function_body` (whose previous
     *   sibling is the signature carrying the params) or a `function_expression`
     *   (a closure, carrying its own `parameters`).
     * @param signature  The previous-sibling signature for a `function_body`, or
     *   undefined for a `function_expression` (which carries params directly).
     */
    constructor(fnNode: SyntaxNode, signature: SyntaxNode | undefined);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The body subtree to pre-scan: a `function_body`'s `block`/expr, or a closure's body. */
    private bodyOf;
    /** The `formal_parameter_list` owning this function's params. */
    private paramList;
    /** Every `formal_parameter`'s bound name node. */
    private paramNames;
    private declare;
    private declareParams;
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested function/closure bodies (opaque).
     */
    private prescan;
    /** Declare every name of an `initialized_variable_definition` (`var a = 1, b = 2`). */
    private declareInitializedVar;
    /**
     * Declare a `for`'s loop variable: a C-style `init:local_variable_declaration`
     * is handled by its own `initialized_variable_definition` recursion; a for-in
     * binds the `name:identifier` after the optional `inferred_type`/type. A for-in
     * over an existing variable (`for (e in xs)`) has no declaration — its bare
     * `identifier` is a use (an assignment target), not a new binding.
     */
    private declareForParts;
    /** A `for_loop_parts` is for-in iff it has an `in` keyword child + a `value` field. */
    private isForIn;
    /** A for-in declares a fresh loop var iff a binder keyword/type precedes the name. */
    private forInDeclares;
    /** Declare a `catch (e[, st])` error name(s). */
    private declareCatchParams;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position binding carrier (`var x = switch (…) {…}`,
     * #2207): just the declared name(s)' def, attached to the continuation block the
     * switch arms rejoin. The subject + arm-value USES are already harvested onto
     * the branch's own blocks, so this must NOT re-walk the value — only each
     * `initialized_variable_definition`'s `name` (and trailing binders) is a def.
     */
    bindingDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /**
     * Facts for a `for` head. For-in: the loop var name is a def, the collection a
     * use. C-style: the init/condition/update sub-expressions are walked for
     * defs/uses (the init `local_variable_declaration` defines, the condition reads,
     * the update def-and-uses).
     */
    forHeadFacts(parts: SyntaxNode | undefined): StatementFacts | undefined;
    /** ENTRY-block facts for the parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact(s) for a `catch (e[, st])` — prepend to the handler entry block. */
    catchParamFacts(catchParams: SyntaxNode | undefined): StatementFacts | undefined;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    private walkValue;
    /**
     * Walk a container's named children, coalescing each Dart postfix RUN — a
     * chain HEAD immediately followed by one or more `selector` (and/or a
     * `cascade_section`) siblings — into a single {@link walkRun} so a member /
     * free call across the run is harvested as ONE call site. A child that does
     * not start a run walks via {@link walkValue} as before.
     */
    private walkChildren;
    /** A postfix-run suffix node: a `.name`/`(args)` `selector` or a `..m()` cascade. */
    private isSuffix;
    /**
     * Walk a binary / ternary expression whose operands are FLATTENED across the
     * node's children (`a ?? g(x)` ⇒ children `a`, `??`, `g`, `selector`). The
     * children before the FIRST boundary operator (`boundaries`) run
     * unconditionally; everything after a boundary is conditionally evaluated (a
     * may-def context). Each segment is grouped via {@link walkChildren} so a
     * postfix call split across children (`g` + `selector`) is one site.
     */
    private walkBinaryConditional;
    /**
     * Walk one postfix run `[head, suffix*]`. A lone node (no suffixes) is just a
     * value walk. A run with suffixes is a Dart call/access chain: each `selector`
     * whose inner is an `argument_part` is a call applied to the prefix; an
     * assignable `.name`/`?.name` selector is a member access; a `cascade_section`
     * with an `argument_part` is a free call on its method name.
     */
    private walkRun;
    /** The chain root binding node — an `identifier` head (not `this`/`super`/literal). */
    private chainHead;
    /** The bound name identifier of an assignable selector inner (`.name` ⇒ `name`). */
    private selectorName;
    /** Dotted callee path `root.a.b` (or undefined when the root is not an identifier). */
    private calleePath;
    /**
     * The `at` anchor for a call `selector` at `run[i]`, byte-aligned with the
     * Dart CALLS `atRange` (see file header): a FREE / implicit-constructor call
     * (the call selector immediately follows the chain head) anchors on the head
     * identifier; a MEMBER call anchors on the method-NAME identifier of the
     * preceding `.method` selector.
     */
    private callAnchor;
    /**
     * Open + populate a call site for a Dart postfix `prefix(args)` call. The
     * callee NAME is a statement-level use (recorded as the chain root above, or
     * here for a bare free call), NOT a value occurrence in any enclosing argument.
     */
    private visitChainCall;
    /** Index in `run` of the LAST call-marker selector (`selector(argument_part)`). */
    private lastCallSelectorIndex;
    /** A single `new Foo(args)` constructor site (`kind: 'new'`). */
    private visitNew;
    /** A cascade call `a..method(args)` — a FREE call on the method name. */
    private visitCascade;
    /** Walk a `selector → argument_part → arguments` for per-arg occurrences. */
    private walkArguments;
    /** Walk an `arguments` node, tagging each positional / named arg's occurrence position. */
    private walkArgumentsNode;
    /**
     * Register result-defs for a single-target binding whose value RUN's terminal
     * call / `new` should carry `[x]`: `var x = f()` / `var x = obj.m()` /
     * `var x = new Foo()` / `x = g(y)`. Keyed so the run's call selector (whose
     * `.parent` is the run's shared parent — the `initialized_variable_definition`
     * or `assignment_expression`) AND a single `new_expression` run-node both hit.
     */
    private registerRunResultDefs;
    /** The `field`-tagged children of `node` (a Dart postfix run flattens here). */
    private fieldRun;
    /**
     * The bare `identifier` of an `assignable_expression` lvalue WHEN it is a
     * scalar target (`x = …`), or undefined when it is a member / subscript write
     * (`obj.x = …`, `a[i] = …`) — those carry a trailing
     * `unconditional_assignable_selector` / `conditional_assignable_selector` /
     * `index_selector` and are NOT scalar defs (their root identifier is a use).
     */
    private scalarAssignTarget;
}
