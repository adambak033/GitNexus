/**
 * Kotlin def/use harvester (#2195) — the Kotlin analogue of
 * {@link import('./swift-harvest.js').SwiftHarvester} and the C-family / Go /
 * Rust / Python harvesters. Like the Go / Python / Dart harvesters it harvests
 * the per-function binding table ({@link BindingEntry}[]) plus
 * {@link StatementFacts} (defs / uses / mayDefs) AND a taint
 * {@link import('../types.js').SiteRecord} per call (callee path, receiver,
 * per-arg occurrence entries, result defs, spread marker, and an `at` anchor)
 * via the shared {@link CallSiteFactAccumulator} — the same site substrate the
 * C-family / Go / TS / Python / Dart harvesters emit (#2227 follow-up).
 *
 * KOTLIN CALL SHAPE (verified by a real parse — see below). A call is a
 * `call_expression` whose LAST child is a `call_suffix` (holding the
 * `value_arguments` and/or a trailing `annotated_lambda`); the callee is the
 * preceding expression — a bare `simple_identifier` (`foo()`) for a FREE call,
 * or a `navigation_expression` (`obj.method` / `a?.b` via `navigation_suffix`)
 * for a MEMBER call. A chained call `a.b.c()` nests `navigation_expression`s;
 * the receiver is the chain ROOT binding. Kotlin constructor calls look like
 * ordinary calls (no `new`), so every site is `kind: 'call'` (the CALLS query
 * classifies a capitalized/known-type callee as `@reference.call.constructor`,
 * but the harvester only needs callee + receiver + `at` right — `kind` is not
 * joined). Named args (`name = value`) record the VALUE occurrence and drop the
 * name (like Python / Dart).
 *
 * ANCHOR ALIGNMENT (plan KTD7 — load-bearing): a call site's `at` MUST be the
 * SAME `[line (1-based), col (0-based)]` the Kotlin CALLS resolution keys its
 * `atRange` on, because a downstream unit joins the two by EXACT position. The
 * Kotlin scope query (query.ts) anchors `@reference.call.free` and
 * `@reference.call.member` on the WHOLE `call_expression` node (the
 * `@reference.name` simple_identifier and the `@reference.receiver` are SUB-tags,
 * excluded from the anchor by `KNOWN_SUB_TAGS` + the broadest-span rule in
 * `anchorCaptureFor`; `atRange: anchor.range` at scope-extractor.ts:1030). So for
 * a free call `foo(x)`, a member call `obj.method(x)`, and a chained call
 * `a.b.c(x)` alike, `at` is the start of the enclosing `call_expression` node —
 * which, for a member/chained call, starts at the RECEIVER (`obj`/`a`), exactly
 * where the CALLS anchor starts too. This is the Go/Python whole-call-node model,
 * NOT the Dart callee-name model. The harvester's `visitCall` receives exactly
 * the `call_expression` node and records `[node.startPosition.row + 1,
 * node.startPosition.column]`.
 *
 * Runs in the parse worker next to the Kotlin CFG visitor. Output is the binding
 * table the {@link import('../cfg-builder.js').CfgBuilder} stamps onto the CFG,
 * plus the per-block def/use facts the reaching-defs / CDG solvers consume.
 *
 * Every node-type literal below was grammar-validated against the VENDORED
 * tree-sitter-kotlin via the introspection probe before use (mandatory pre-step).
 * The grammar is FIELD-LESS for the constructs harvested here (no
 * `childForFieldName` fields on `parameter` / `property_declaration` /
 * `for_statement` / etc.), so this harvester navigates by child TYPE and position.
 * Kotlin shapes pre-empted (verified by a real parse):
 *  - functions: `function_declaration` (`fun` `simple_identifier`
 *    `function_value_parameters` `function_body`), `anonymous_function`
 *    (`fun function_value_parameters function_body`), `lambda_literal`
 *    (`{ lambda_parameters? -> statements }`).
 *  - parameters: `function_value_parameters` → `parameter`
 *    (`simple_identifier : user_type`). A lambda's params live in
 *    `lambda_parameters` → `variable_declaration` (each a `simple_identifier`,
 *    optionally `: user_type`).
 *  - `property_declaration` — `binding_pattern_kind` (`val`/`var`), then a
 *    `variable_declaration` (`simple_identifier`) OR a `multi_variable_declaration`
 *    (`( variable_declaration, … )` for `val (a, b) = p`), then `= value`.
 *  - `for_statement` — pattern is a `variable_declaration` / `multi_variable_declaration`
 *    after `(`; the iterated collection is the expression after `in`.
 *  - `catch_block` — `catch ( simple_identifier : user_type ) { statements }`; the
 *    bound error is the `simple_identifier`.
 *  - `when_subject` — `( expr )` or `( val variable_declaration = expr )`.
 *  - reads: `simple_identifier`, `navigation_expression` (`a.b` / `a?.b`),
 *    `call_expression`, `assignment` (`directly_assignable_expression` lvalue +
 *    operator + value), `elvis_expression` (`a ?: b`).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the Swift / Rust / Go
 * harvesters): the CFG walk is NOT source-order (`do … while` builds the condition
 * after the body), so resolving names against a scope stack populated *during* the
 * walk would mis-resolve. Phase 1 pre-scans the whole function subtree once,
 * declaring every bound name into ONE function table; phase 2 resolves defs/uses
 * against that finished table from any walk order. Kotlin DOES have block scope +
 * shadowing, but a single function table is the documented v1 simplification used
 * by the Swift / Python / Rust harvesters — distinct shadowing redeclarations of
 * the same name collapse onto one binding (an over-approximation that can falsely
 * kill across a shadow, the sound direction for taint).
 *
 * v1 def-semantics scope:
 *   - `property_declaration` (`val`/`var PAT = …`) — each `simple_identifier` leaf
 *     of the `variable_declaration` / `multi_variable_declaration` is a def; the
 *     value is walked for uses.
 *   - `assignment` plain `=` — a plain-identifier lvalue is a def; a
 *     `navigation_expression` / subscript target (`this.x = …`, `a[i] = …`) is NOT
 *     a scalar def (its root is a use). A compound `+=`/`-=`/… target def-AND-uses
 *     the lvalue.
 *   - `for (x in xs)` — the loop pattern's leaves are defs, the collection a use.
 *   - a `when (val r = e)` subject binds `r`.
 *   - `catch_block`'s error identifier binds.
 *   - parameters (incl. lambda params) are `param`-kind defs.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): member / subscript writes
 * (`obj.f = …`, `a[i] = …`) are NOT scalar defs — their root identifiers are uses
 * only. Nested-function bodies (`lambda_literal`, nested `anonymous_function` /
 * `function_declaration`) are opaque in BOTH directions.
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` short-circuit, the elvis (`?:`) right operand and a
 * safe-call (`?.`) chain, and a `when`-entry case test — is a may-def (gen WITHOUT
 * kill), so the not-taken path's prior def is not falsely killed.
 *
 * Identifiers with no in-function declaration (top-level functions, types,
 * properties) resolve to a SYNTHETIC module-level binding (`name@module`), applied
 * identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class KotlinHarvester {
    private readonly fnNode;
    private readonly bindings;
    /** Single function-scope name → binding index (v1: no block scope). */
    private readonly table;
    private readonly synthetic;
    private readonly fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    private conditionalDepth;
    /**
     * `call_expression` node id → binding indices its single-target result is
     * assigned to (`val x = f()` / `x = g()` ⇒ `[x]`). Populated just before the
     * value walk reaches the call (see {@link registerResultDefs}) and consumed by
     * {@link visitCall}. Mirrors the Go / Python / Dart harvesters' `resultDefTargets`.
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The function/lambda body subtree to pre-scan (`statements` or `function_body`). */
    private bodyOf;
    private declare;
    /** Declare every parameter binder of a fn / anonymous fn / lambda. */
    private declareParams;
    /** Declare the `simple_identifier` of a `variable_declaration`. */
    private declareVariableDeclaration;
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested function/lambda bodies (opaque).
     */
    private prescan;
    /** Declare every binder of a `property_declaration`'s pattern (single or multi). */
    private declarePropertyPattern;
    /** Declare a `for` loop variable (`variable_declaration` / `multi_variable_declaration`). */
    private declareForPattern;
    /** Declare a `catch (e: T)` error name. */
    private declareCatchParam;
    /** Declare a `when (val r = e)` subject binding. */
    private declareWhenSubject;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for ( PAT in COLLECTION )` head: the loop pattern's leaves are
     * defs, the iterated collection a use.
     */
    forHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** Facts for a `when` subject: a `val r = e` binds `r` (def); the expr's uses. */
    whenSubjectFacts(subject: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position binding carrier (`val x = <branch>`,
     * #2205): just the bound name's def, attached to the continuation block the
     * branch arms rejoin. The branch subject + arm-value USES are already harvested
     * onto the branch's own blocks (visitWhen / visitIf), so this must not re-walk
     * them — only the `variable_declaration` leaves are defs here.
     */
    bindingDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /**
     * Def-ONLY facts for a value-position assignment carrier (`x = when (k) {…}`,
     * #2205): just the LHS target, attached to the continuation block the branch
     * arms rejoin. The branch subject + arm-value USES are already harvested onto
     * the branch's own blocks, so this must NOT re-walk the RHS — only a plain `=`
     * to a simple-identifier lvalue defines (a member / index target is not a
     * scalar def; a compound `+=` is not a value-branch carrier).
     */
    assignmentDefFacts(node: SyntaxNode): StatementFacts | undefined;
    /** ENTRY-block facts for the parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (e: T)` error name — prepend to the handler entry block. */
    catchParamFacts(catchBlock: SyntaxNode): StatementFacts | undefined;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /** Def the `simple_identifier` of a `variable_declaration`. */
    private defVariableDeclaration;
    /** Def every binder of a `for` loop pattern. */
    private defForPattern;
    /** The iterated collection of a `for_statement` — the named child after `in`. */
    private forCollection;
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    private walkValue;
    /** True iff `node` carries a `++` / `--` operator token (`x++` / `--x`). */
    private isIncDec;
    /** The `= value` expression of a `property_declaration` (the child after `=`). */
    private propertyValue;
    /** The assignment operator text (`=` / `+=` / …) of an `assignment`. */
    private assignmentOperator;
    /** The right-hand value of an `assignment` (the named child after the operator). */
    private assignmentValue;
    /** Strip a `directly_assignable_expression` wrapper around an lvalue. */
    private unwrapAssignable;
    /** Strip `parenthesized_expression` wrappers around a value (`(f())`). */
    private unwrapValue;
    /**
     * When `value`'s root (after stripping parens) is a `call_expression`, remember
     * that call site should carry `resultDefs` — the binding indices of `targets`
     * (def-position identifiers). Consumed by {@link visitCall} once the value walk
     * reaches the node. Single-target only (the caller restricts to a plain
     * identifier binder); the blank target (`_`) binds nothing and is skipped.
     */
    private registerResultDefs;
    /**
     * The callee node of a `call_expression` — the first named child that is NOT
     * the trailing `call_suffix` (a bare `simple_identifier` for a free call, or a
     * `navigation_expression` for a member/chained call).
     */
    private calleeOf;
    /**
     * Explicit `call_expression` handler. Records a call site (callee path,
     * receiver, per-arg occurrence entries, result defs, spread marker) while
     * reproducing EXACTLY the uses the old default descent recorded (callee chain
     * root + arguments). Kotlin has no `new` — every site is `kind: 'call'`.
     */
    private visitCall;
    /**
     * Walk a `call_suffix`'s `value_arguments`, tagging each positional / named /
     * spread argument's occurrence position. A trailing `annotated_lambda` is a
     * nested function body — opaque (its `lambda_literal` is excluded by
     * {@link NESTED_FUNCTION_TYPES}), so it is not an argument occurrence here.
     */
    private walkArguments;
    /**
     * The value expression of a `value_argument` — for a named argument
     * (`name = value`) the leading `simple_identifier` name is dropped (it is a
     * parameter name, not a use), and only the value after `=` is returned; a
     * positional argument's value is its sole non-comment named child.
     */
    private argumentValue;
    /**
     * `navigation_expression` chain walk shared by value position and callee
     * position. Records the chain-root identifier as a use (identical to the old
     * default descent) plus at most ONE member-read site — the INNERMOST access —
     * when the root is an identifier; `skipFinalRead` suppresses it when that
     * access is the callee (carried by the dotted path instead). Mirrors the Go /
     * Python harvesters' `walkChain`.
     */
    private walkChain;
}
