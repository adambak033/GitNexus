/**
 * C / C++ def/use harvester (#2195 U2, plan KTD2) — the C-family analogue of
 * {@link import('./typescript-harvest.js').TsHarvester}.
 *
 * Runs in the parse worker next to the C/C++ CFG visitor, extracting
 * per-statement variable definition/use facts that ride the side channel for
 * the reaching-defs / CDG solvers. Output is the per-function binding table
 * ({@link BindingEntry}[]) plus {@link StatementFacts} the visitor attaches to
 * blocks as it walks. One class serves both languages: the control-flow node
 * set is identical (grammar-introspection probe confirmed — see U2 report),
 * and the harvest's def/use node taxonomy (`declaration`/`init_declarator`/
 * `assignment_expression`/`update_expression`/`parameter_declaration`) is shared
 * too; C++-only `lambda_expression` is handled exactly like a nested function
 * (opaque), so no language naming or branching is needed.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS harvester): the
 * CFG walk is NOT source-order (`visitFor` builds the init block after the body,
 * `visitDoWhile` the condition before the body), so resolving names against a
 * scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once into a completed lexical scope tree; phase 2
 * resolves defs/uses against that finished tree from any walk order.
 *
 * v1 def-semantics scope:
 *   - `declaration` → `init_declarator` (an initialized local is a def; a bare
 *     `int x;` with no initializer writes nothing at runtime — not a def, like
 *     the TS bare-`var` rule).
 *   - `assignment_expression` (plain + compound `+=` etc.), `update_expression`
 *     (`x++`/`--x`) — define and (for compound/update) also use the lvalue.
 *   - parameters (`parameter_declaration` declarator chain).
 * EXCLUDED, deliberately (TypeScript-CFA precedent): member / pointer / array
 * writes (`obj.f = …`, `*p = …`, `a[i] = …`) are NOT scalar defs — their
 * identifiers are uses only. Both directions of nested-function (C++ lambda)
 * capture are invisible (the lambda body is an opaque block in the enclosing
 * CFG, exactly as TS treats arrow/function bodies).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&`/`||` (`if (a && (x = f()))`), a ternary arm, or a switch
 * case-test — is a may-def (gen without kill), so the not-taken path's prior
 * def is not falsely killed.
 *
 * Identifiers with no in-function declaration (globals, macros, params of an
 * enclosing scope) resolve to a SYNTHETIC module-level binding (`name@module`),
 * applied identically by def and use harvesting.
 *
 * RAII NOTE: C++ destructors that run at scope exit are NOT represented in the
 * tree-sitter AST (they are implicit), so this harvest cannot and does not model
 * destructor side effects — documented gap, see the visitor doc-comment.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { StatementFacts } from '../types.js';
import { ScopeTreeHarvester, type Scope } from './scope-tree-harvest.js';
export declare class CCppHarvester extends ScopeTreeHarvester {
    constructor(fnNode: SyntaxNode);
    /** The function/lambda body block (`compound_statement`). */
    private bodyOf;
    /** The bare identifier a declarator chain ultimately names (or undefined). */
    private declaratorName;
    private declareParams;
    private findFunctionDeclarator;
    protected prescan(node: SyntaxNode, scope: Scope): void;
    /**
     * The `structured_binding_declarator` a declarator binds (C++17 `auto [a,b]`,
     * or `auto& [a,b]` whose binding sits under a `reference_declarator`), or
     * undefined. C has no structured bindings, so this is inert for C.
     */
    private structuredBinding;
    /** The identifier leaves a `structured_binding_declarator` binds (`[a, b]`). */
    private structuredBindingNames;
    private declareDeclarators;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /** Facts for a `for (decl : right)` range head: decl binds, right is used. */
    forRangeHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the function's parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (T& e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause: SyntaxNode): StatementFacts | undefined;
    /** Strip parenthesized wrappers around an lvalue (`(x) = 1`). */
    private unwrapLvalue;
    /** Value-position walk: collect uses; route def positions to the lvalue handler. */
    private walkValue;
    /**
     * When `value`'s root (after stripping parens) is a call/new node, remember
     * that its site should carry `resultDefs: defs` — consumed by
     * {@link visitCall} once the value walk reaches the node.
     */
    private registerResultDefs;
    /**
     * Explicit call/new handler: records a call site (callee path, receiver,
     * per-arg occurrence entries, result defs) while reproducing EXACTLY the uses
     * the old default descent recorded — callee chain root + arguments. `new`
     * sites read the `type` field as the callee; `call` sites the `function`
     * field.
     */
    private visitCall;
    /**
     * Member chain walk shared by value position and callee position. Use-
     * recording is identical to the old default descent (chain-root identifier
     * once). Member-read sites: at most ONE per chain — the INNERMOST access —
     * and only when the chain root is an identifier; `skipFinalRead` suppresses it
     * when that access is the callee (carried by the dotted path instead).
     */
    private walkChain;
    /** Dotted path of a `ns::a::b` qualified_identifier (`::` folded to `.`). */
    private qualifiedPath;
}
