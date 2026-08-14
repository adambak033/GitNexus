/**
 * C# def/use harvester (#2195 U3, plan KTD2) — the C# analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the closely-related
 * {@link import('./c-cpp-harvest.js').CCppHarvester}.
 *
 * Runs in the parse worker next to the C# CFG visitor, extracting per-statement
 * variable definition/use facts that ride the side channel for the reaching-defs
 * / CDG solvers. Output is the per-function binding table ({@link BindingEntry}[])
 * plus {@link StatementFacts} the visitor attaches to blocks as it walks.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS / C-C++ harvesters):
 * the CFG walk is NOT source-order (`visitFor` builds the init block after the
 * body, `visitDoWhile` the condition before the body), so resolving names against
 * a scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once into a completed lexical scope tree; phase 2
 * resolves defs/uses against that finished tree from any walk order.
 *
 * v1 def-semantics scope:
 *   - `local_declaration_statement` → `variable_declaration` → `variable_declarator`
 *     (an INITIALIZED local is a def; a bare `int x;` with no initializer writes
 *     nothing at runtime — not a def, like the TS bare-`var` rule).
 *   - `assignment_expression` (plain + compound `+=` etc.), `postfix_unary_expression`
 *     / `prefix_unary_expression` (`x++` / `--x`) — define and (for compound /
 *     update) also use the lvalue.
 *   - parameters (`parameter` → `name` field), the `foreach` loop variable
 *     (`foreach_statement` field `left`), pattern bindings (`declaration_pattern`
 *     `name`, e.g. `o is string s` / `case int n:`), and catch-clause names
 *     (`catch_declaration` `name`).
 * EXCLUDED, deliberately (TypeScript-CFA precedent): member / element / pointer
 * writes (`obj.F = …`, `a[i] = …`) are NOT scalar defs — their identifiers are
 * uses only. Nested-function (lambda / local-function / anonymous-method) bodies
 * are opaque in BOTH directions (writes to and reads of captured outer variables
 * are invisible).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` / `??` (`a ?? (a = load())`), a ternary arm, or a switch
 * arm/case test — is a may-def (gen without kill), so the not-taken path's prior
 * def is not falsely killed.
 *
 * Identifiers with no in-function declaration (fields, properties, statics,
 * namespaced names) resolve to a SYNTHETIC module-level binding (`name@module`),
 * applied identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { StatementFacts } from '../types.js';
import { ScopeTreeHarvester, type Scope } from './scope-tree-harvest.js';
export declare class CsharpHarvester extends ScopeTreeHarvester {
    constructor(fnNode: SyntaxNode);
    /** The function/lambda body node (a `block` or an expression for `=> expr`). */
    private bodyOf;
    private declareParams;
    protected prescan(node: SyntaxNode, scope: Scope): void;
    /** Declare every `variable_declarator` name in a `variable_declaration`. */
    private declareVariableDeclaration;
    /** Declare a `foreach` target — an identifier or a `tuple_pattern`. */
    private declareForeachTarget;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position binding carrier (`var x = k switch {…}`,
     * #2207): just the declared name(s)' def, attached to the continuation block the
     * switch arms rejoin. The discriminant + arm-value USES are already harvested
     * onto the branch's own blocks ({@link facts} on each arm), so this must NOT
     * re-walk the initializer — only each `variable_declarator`'s name is a def here.
     */
    bindingDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /** Facts for a `foreach (decl in right)` head: decl binds, right is used. */
    forEachHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the function's parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (T e)` declaration — prepend to the handler entry block. */
    catchParamFacts(catchClause: SyntaxNode): StatementFacts | undefined;
    /** Strip parenthesized wrappers around an lvalue (`(x) = 1`). */
    private unwrapLvalue;
    /** Def a `foreach` target (identifier or tuple) in a header fact accumulator. */
    private defForeachTarget;
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    private walkValue;
    /**
     * When `value`'s root (after stripping parens) is an invocation/creation
     * node, remember that its site should carry `resultDefs: defs` — consumed by
     * {@link visitCall} once the value walk reaches the node.
     */
    private registerResultDefs;
    /**
     * Explicit invocation / object-creation handler: records a call site (callee
     * path, receiver, per-arg occurrence entries, result defs) while reproducing
     * EXACTLY the uses the old default descent recorded. C# wraps each argument in
     * an `argument` node; `new Foo(...)` reads the `type` field as the callee.
     */
    private visitCall;
    /**
     * The value expression inside an `argument` node. A named argument
     * (`name: x`) carries the label on the `name` field and the value as a
     * sibling; a positional argument is just the value. Returns the last named
     * child that is not the `name`-field label (and skips `ref`/`out`/`in`
     * modifier keywords, which are anonymous tokens, not named children).
     */
    private argumentValue;
    /**
     * Member chain walk shared by value position and callee position. Records the
     * chain-root identifier as a use (identical to the old default descent), plus
     * at most ONE member-read site — the INNERMOST access — when the root is an
     * identifier; `skipFinalRead` suppresses it when that access is the callee.
     */
    private walkChain;
    /**
     * The initializer value of a `variable_declarator` — the named child after
     * `name`. NOTE: deliberately duplicated in `csharp.ts` (the visitor is a
     * standalone class with no shared base — repo convention). The two copies must
     * stay in sync; there is no C#-specific shared module to host it, and the only
     * module both files share is the generic `utils/ast-helpers` (types only).
     */
    private declaratorInit;
    /** Whether a unary expression is `++`/`--` (the only writing unary ops). */
    private isIncDec;
    /** Def each identifier in a `(a, b) = …` tuple deconstruction target. */
    private defTupleTargets;
}
