/**
 * TS/JS def/use harvester (#2082 M2 U1).
 *
 * Runs in the parse worker next to the CFG visitor, extracting per-statement
 * variable definition/use facts that ride the side channel for the
 * reaching-defs solver (`cfg/reaching-defs.ts`). Output is the per-function
 * binding table ({@link BindingEntry}[]) plus {@link StatementFacts} records
 * the visitor attaches to blocks as it walks.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing): the CFG walk is NOT source-order
 * — `visitTry` builds the finally body before the protected body, `visitFor`
 * creates the init block after walking the body, `visitDoWhile` the condition
 * before the body. Resolving names against a scope stack populated *during*
 * that walk would mis-resolve common code (`try { var v = 1; } finally
 * { use(v); }` keys the use synthetically while the def gets the real binding —
 * the def→use fact silently never forms, a taint false negative). So phase 1
 * pre-scans the whole function subtree once, collecting every declaration into
 * a completed lexical scope tree (also resolving `var` hoisting and multi-decl
 * canonicalization order-independently, eslint-scope style); phase 2 resolves
 * defs/uses against that finished tree from any walk order.
 *
 * v1 def-semantics scope (plan KTD4): var/let/const declarations, assignments
 * (plain/compound/destructuring), update expressions, function/class
 * declarations, parameters (incl. defaults/rest/destructured), catch params,
 * for-in/of heads. EXCLUDED, deliberately: property/member writes (`this.x=`,
 * `obj.p=` — TypeScript-CFA precedent), and BOTH directions of nested-function
 * capture — writes to outer variables from nested bodies AND reads of captured
 * variables inside nested bodies are invisible (nested functions are opaque
 * blocks in the enclosing CFG; callback flows like `arr.forEach(() => sink(y))`
 * register no use of `y` — closure/callback dataflow is M4 territory and the
 * M3 consumer contract must name it).
 *
 * Identifiers with no in-function declaration (implicit globals, imports,
 * variables captured from an enclosing function) resolve to a SYNTHETIC
 * module-level binding (`name@module`), applied identically by def and use
 * harvesting so `notDeclared = 1; use(notDeclared)` still forms a fact.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class TsHarvester {
    private readonly fnNode;
    private readonly bindings;
    /** Scope-opening node id → its scope. */
    private readonly scopeByNode;
    private readonly root;
    /** name → synthetic binding index (implicit global / import / captured). */
    private readonly synthetic;
    private readonly fnId;
    /**
     * Innermost enclosing scope per visited node id, filled during the prescan
     * (which already touches every named node once). Makes phase-2 resolution
     * O(scope-chain) instead of O(AST-depth) per identifier — a deeply-chained
     * single-statement expression (generated code) otherwise turns the
     * parent-chain walk quadratic (tri-review perf finding).
     */
    private readonly nearestScopeCache;
    /**
     * >0 while walking a conditionally-evaluated subexpression (short-circuit
     * right operand, ternary arm, logical-assignment target, case test). Defs
     * found there are MAY-defs — gen without kill (tri-review P1: a must-def
     * here falsely kills the prior def on the not-taken path).
     */
    private conditionalDepth;
    /**
     * Call/new node id → bindings whose declarator/assignment VALUE is exactly
     * that call (#2083 M3 U1). Registered by the declarator/assignment handlers
     * BEFORE the value walk, consumed by {@link visitCall} when it reaches the
     * node — the indirection keeps result-def attribution per-declarator
     * (`const a = t, b = escape(t)` attaches `[b]` to the escape site only) and
     * top-level-only (`const c = cond ? escape(b) : b` attaches nothing — the
     * bypass occurrence must keep `c` taintable, plan KTD4a).
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    table(): readonly BindingEntry[];
    private openScope;
    private nearestScopeOf;
    private declare;
    private declareParams;
    /**
     * Declare every name bound by a (possibly destructuring) pattern. When
     * `formalIndex` is supplied (param patterns), EVERY name the pattern binds
     * carries that one enclosing-formal position (the recursion never reassigns
     * it), so `function f({a, b}, c)` records a:0, b:0, c:1.
     */
    private declarePattern;
    private prescan;
    private declareDeclarators;
    /**
     * Def/use facts for one statement (or construct-header expression) node.
     * Safe from any walk order — resolution consults the completed scope tree.
     */
    facts(node: SyntaxNode): StatementFacts;
    /**
     * Facts for an expression whose WHOLE evaluation is conditional (switch
     * case tests, which only run when earlier cases didn't match) — every def
     * inside becomes a may-def.
     */
    factsConditional(node: SyntaxNode): StatementFacts;
    /** Facts for a `for (left in/of right)` head: left binds/assigns, right is used. */
    forInHeadFacts(stmt: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the function's parameters (defs + default-value uses). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch (e)` parameter — prepend to the handler entry block. */
    catchParamFacts(catchClause: SyntaxNode): StatementFacts | undefined;
    private resolve;
    private def;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /** Strip wrappers that don't change the lvalue (`(x) += 1`, `x! ++`). */
    private unwrapLvalue;
    private use;
    /** Value-position walk: collect uses; route def positions to the pattern walk. */
    private walkValue;
    /** Assignment-target walk: identifiers bind; member/subscript targets are uses. */
    private walkDefPattern;
    /** Strip value-transparent wrappers (`(x)`, `x!`, `x as T`, `await x`). */
    private unwrapValueWrappers;
    /**
     * When `value`'s root (after unwrapping) is a call/new node, remember that
     * its site should carry `resultDefs: defs` — consumed by {@link visitCall}
     * once the value walk reaches the node.
     */
    private registerResultDefs;
    /**
     * Explicit call/new handler: records a call site (callee path, receiver,
     * per-arg occurrence entries, spread/template markers, require literal,
     * result defs) while reproducing EXACTLY the uses the old default descent
     * recorded — callee chain root + dynamic subscript indices + arguments.
     */
    private visitCall;
    /**
     * Member/subscript chain walk shared by value position, write position, and
     * callee position. Use-recording is identical to the old default descent
     * (chain-root identifier once, dynamic subscript index expressions, full
     * walk of non-identifier roots) — NO double-recording. Member-read sites:
     * at most ONE per chain — the INNERMOST access — and only when the chain
     * root is an identifier and the access's key is static (`.prop` or a
     * string-literal subscript); `skipFinalRead` suppresses it when that access
     * is the final one (callee / write target). Optional chaining (`?.`) never
     * appears in the output (field-based traversal normalizes it); dynamic
     * computed keys record nothing (documented KTD10 FN).
     */
    private walkChain;
}
