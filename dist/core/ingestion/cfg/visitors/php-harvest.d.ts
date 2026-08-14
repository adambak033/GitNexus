/**
 * PHP def/use harvester (PDG layer — brace-family CFG, closest to Java/C#).
 *
 * Runs in the parse worker next to the PHP CFG visitor, extracting per-statement
 * variable definition/use facts that ride the side channel for the reaching-defs
 * / CDG solvers. Output is the per-function binding table ({@link BindingEntry}[])
 * plus {@link StatementFacts} the visitor attaches to blocks as it walks. The
 * call-site substrate ({@link CallSiteFactAccumulator}) is harvested too (it is
 * INERT until a PHP source/sink model is registered).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the Java / C# harvesters):
 * the CFG walk is NOT source-order (`visitFor` builds the init block after the
 * body, `visitDoWhile` the condition before the body), so resolving names against
 * a scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once into a completed lexical scope tree; phase 2
 * resolves defs/uses against that finished tree from any walk order.
 *
 * PHP-SPECIFIC NOTE — PHP variables are FUNCTION-SCOPED (no block scope): a `$x`
 * written inside an `if` body is the SAME variable as one written at the top
 * level (unlike Java/C# block scoping). So the harvester declares EVERY assigned/
 * parameter/foreach/catch variable into the single function-root scope; there is
 * no per-block shadowing. The grammar carries the leading `$` on `variable_name`
 * text (`$x`), which we keep as the binding name (consistent and unambiguous).
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-php (`php_only` export) via the introspection probe before use
 * (mandatory pre-step). PHP shapes pre-empted (verified by a real parse):
 *  - functions: `function_definition`/`method_declaration` (fields
 *    `name`/`parameters`/`body`), `anonymous_function` (`parameters`/`body` plus
 *    an `anonymous_function_use_clause` capturing outer vars), `arrow_function`
 *    (`parameters`/`body`; body is an EXPRESSION).
 *  - parameters: `simple_parameter` / `variadic_parameter` /
 *    `property_promotion_parameter`, each with a `name` field (`variable_name` or
 *    a `by_ref` wrapping one); `simple_parameter` may carry `default_value`.
 *  - assignment: `assignment_expression` (`left`/`right`),
 *    `augmented_assignment_expression` (`left`/`operator`/`right`, def+use),
 *    `update_expression` (`argument`/`operator`, def+use). An lvalue may be a
 *    `variable_name`, a `list_literal` (`[$a,$b]` / `list($a,$b)` destructure),
 *    a `member_access_expression` (`$o->p` — a USE of the object, not a scalar
 *    def), or a `subscript_expression` (`$a[$i]` — same).
 *  - `foreach_statement`: the iterable + a value `variable_name`, OR a
 *    `pair` (`$k => $v`) binding both — NO field names (positional children).
 *  - `catch_clause` (`type`/`name`/`body`): `name` is the exception
 *    `variable_name`.
 *  - conditional contexts: `binary_expression` operator `&&`/`||`/`??`,
 *    `conditional_expression` (`condition`/`body`/`alternative`; short `?:` omits
 *    `body`), and switch/match case tests.
 *
 * v1 def-semantics scope:
 *   - assignment / augmented-assignment / update to a `variable_name` (or to a
 *     `list_literal` destructure target) — define (and, for augmented/update, use)
 *     the variable.
 *   - parameters, the `foreach` value/key variable, catch parameters, and
 *     `anonymous_function` `use (...)` captures (by-value AND by-ref).
 * EXCLUDED, deliberately (TypeScript-CFA precedent, mirrored by Java): property /
 * array-element writes (`$o->p = …`, `$a[$i] = …`) are NOT scalar defs — their
 * variables are uses only. Nested-function (closure / arrow) bodies are opaque in
 * BOTH directions.
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` / `??` (`$a && ($x = f())`, `$c ?? ($c = load())`), a
 * ternary arm, or a switch/match case test — is a may-def (gen without kill), so
 * the not-taken path's prior def is not falsely killed.
 *
 * Identifiers with no in-function declaration (globals, statics, imported names)
 * resolve to a SYNTHETIC module-level binding (`name@module`), applied
 * identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class PhpHarvester {
    private readonly fnNode;
    private readonly bindings;
    /** PHP is function-scoped: one flat table, name → binding index. */
    private readonly table;
    private readonly synthetic;
    private readonly fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    private conditionalDepth;
    /**
     * Call/new node id → bindings whose declarator/assignment VALUE is exactly
     * that call. Registered before the value walk, consumed by {@link visitCall} /
     * {@link visitNew} (mirrors the Java harvester's `resultDefTargets`).
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The function/closure body node (a `compound_statement`, or an expression). */
    private bodyOf;
    private declare;
    /** The `$name` text of a parameter's `name` field (a `variable_name` or `by_ref`). */
    private paramVarName;
    private declareParams;
    /** `anonymous_function ... use ($a, &$b)` — each captured var binds in the closure. */
    private declareUseClause;
    /** The captured `variable_name`s of a `use (...)` clause (unwrapping `by_ref`). */
    private useClauseVars;
    /**
     * Walk the function body once, declaring every assigned / foreach / catch
     * variable into the FLAT function scope (PHP has no block scoping). Nested
     * function/closure bodies are NOT descended (opaque).
     */
    private prescan;
    /**
     * Declare the variable(s) named by an assignment lvalue: a plain
     * `variable_name`, or a `list_literal` destructure (`[$a,$b]` / `list($a,$b)`,
     * possibly keyed `["x" => $e]`). Member / subscript targets bind nothing.
     */
    private declareLvalue;
    /** Every `variable_name` bound by a `list_literal` (including keyed entries). */
    private listTargets;
    /**
     * The bound variable(s) of a `foreach ($it as [$k =>] $v)`: the value (and key)
     * `variable_name`s. The structure is positional — the FIRST named child is the
     * iterable, then either a bare `variable_name` (value) or a `pair` ($k => $v).
     */
    private foreachTargets;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position assignment carrier (`$x = match($v) {…}`,
     * #2207): just the LHS target(s), attached to the continuation block the match
     * arms rejoin. The match condition + arm-value USES are already harvested onto
     * the branch's own blocks (visitMatch), so this must NOT re-walk the RHS. A
     * member/subscript target (`$this->x = match …`) has no scalar def → undefined.
     */
    assignmentDefFacts(assignExpr: SyntaxNode): StatementFacts | undefined;
    /** Facts for a `foreach ($it as [$k =>] $v)` head: targets bind, iterable used. */
    foreachHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the function's parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (T $e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause: SyntaxNode): StatementFacts | undefined;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /** Strip parenthesized wrappers around an lvalue (`($x) = 1`). */
    private unwrapParen;
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    private walkValue;
    /**
     * When `value`'s root (after stripping parens) is a call / object-creation
     * node, remember its site should carry `resultDefs: defs`.
     */
    private registerResultDefs;
    /**
     * Call-site handler for the three PHP call shapes:
     *  - `function`: `function_call_expression` (`function` field = name, no receiver)
     *  - `member`:   `member_call_expression` (`object` receiver, `name` method)
     *  - `scoped`:   `scoped_call_expression` (`scope` class, `name` method)
     * Reproduces the same uses the default descent recorded plus the call site.
     */
    private visitCall;
    /** Explicit `object_creation_expression` (`new Foo($x)`) handler. */
    private visitNew;
    /** Walk an `arguments` node, tagging each positional `argument` for occurrences. */
    private walkArgs;
    /**
     * Member-access chain walk shared by value position and a method-call receiver.
     * Records the chain-root `variable_name` as a use plus at most ONE member-read
     * site — the innermost access — when the root is a variable.
     */
    private walkChain;
}
