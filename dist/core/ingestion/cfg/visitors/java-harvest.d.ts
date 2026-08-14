/**
 * Java def/use harvester (#2195 U4, plan KTD2) — the Java analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the closely-related
 * {@link import('./csharp-harvest.js').CsharpHarvester}.
 *
 * Runs in the parse worker next to the Java CFG visitor, extracting per-statement
 * variable definition/use facts that ride the side channel for the reaching-defs
 * / CDG solvers. Output is the per-function binding table ({@link BindingEntry}[])
 * plus {@link StatementFacts} the visitor attaches to blocks as it walks.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS / C# harvesters):
 * the CFG walk is NOT source-order (`visitFor` builds the init block after the
 * body, `visitDoWhile` the condition before the body), so resolving names against
 * a scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once into a completed lexical scope tree; phase 2
 * resolves defs/uses against that finished tree from any walk order.
 *
 * v1 def-semantics scope:
 *   - `local_variable_declaration` → `variable_declarator` (an INITIALIZED local
 *     is a def; a bare `int x;` with no initializer writes nothing at runtime —
 *     not a def, like the TS bare-`var` rule).
 *   - `assignment_expression` (plain + compound `+=` etc.) and `update_expression`
 *     (`x++` / `--x`) — define and (for compound / update) also use the lvalue.
 *   - parameters (`formal_parameter` / `spread_parameter` → `name`), the
 *     enhanced-for loop variable (`enhanced_for_statement` field `name`), and
 *     catch parameters (`catch_formal_parameter` → `name`), incl. multi-catch.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): field / array writes
 * (`obj.f = …`, `a[i] = …`) are NOT scalar defs — their identifiers are uses
 * only. Nested-function (lambda) bodies are opaque in BOTH directions (writes to
 * and reads of captured outer variables are invisible).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` (`a && (x = f())`), a ternary arm, or a switch case test
 * — is a may-def (gen without kill), so the not-taken path's prior def is not
 * falsely killed. (Java has no `??`.)
 *
 * Identifiers with no in-function declaration (fields, statics, imported names)
 * resolve to a SYNTHETIC module-level binding (`name@module`), applied
 * identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { StatementFacts } from '../types.js';
import { ScopeTreeHarvester, type Scope } from './scope-tree-harvest.js';
export declare class JavaHarvester extends ScopeTreeHarvester {
    constructor(fnNode: SyntaxNode);
    /** The function/lambda body node (a `block`, or an expression for `x -> expr`). */
    private bodyOf;
    private declareParams;
    /** The `name` identifier of a `formal_parameter` / `spread_parameter`. */
    private paramName;
    protected prescan(node: SyntaxNode, scope: Scope): void;
    /** Declare every `variable_declarator` name in a `local_variable_declaration`. */
    private declareVariableDeclaration;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position binding carrier (`var x = switch (…) {…}`,
     * #2207): just the declared name(s)' def, attached to the continuation block the
     * switch arms rejoin. The switch subject + arm-value USES are already harvested
     * onto the branch's own blocks ({@link facts} on each arm), so this must NOT
     * re-walk the value — only each `variable_declarator`'s `name` is a def here.
     */
    bindingDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /** Facts for a `for (T name : value)` head: name binds, value is used. */
    forEachHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** Facts for the resource-close finalizer: each resource is USED on close. */
    resourceCloseFacts(resources: readonly SyntaxNode[]): StatementFacts | undefined;
    /** ENTRY-block facts for the function's parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (T e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause: SyntaxNode): StatementFacts | undefined;
    /** Strip parenthesized wrappers around an lvalue (`(x) = 1`). */
    private unwrapLvalue;
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    private walkValue;
    /**
     * When `value`'s root (after stripping parens) is a method-invocation /
     * object-creation node, remember its site should carry `resultDefs: defs`.
     */
    private registerResultDefs;
    /**
     * Explicit `method_invocation` handler. Unlike a member-chain callee, Java
     * carries the method NAME on the `name` field and the receiver on a sibling
     * `object` field (`db.query(x)` ⇒ object `db`, name `query`); a bare call
     * (`exec(x)`) has no `object`. Reproduces EXACTLY the uses the old default
     * descent recorded (object root + arguments) and adds the call site.
     */
    private visitCall;
    /** Explicit `object_creation_expression` (`new Foo(x)`) handler. */
    private visitNew;
    /** Walk an `argument_list`, tagging each positional argument for occurrences. */
    private walkArgs;
    /**
     * `field_access` chain walk shared by value position and the method-invocation
     * receiver. Records the chain-root identifier as a use (identical to the old
     * default descent) plus at most ONE member-read site — the INNERMOST access —
     * when the root is an identifier; `skipFinalRead` suppresses it when that
     * access is the callee (never the case for `field_access`, which is value-only).
     */
    private walkChain;
    /** The operand identifier of an `update_expression` (`x++` / `--x`). */
    private updateOperand;
}
