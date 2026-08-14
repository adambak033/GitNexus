/**
 * Ruby def/use harvester — the Ruby analogue of
 * {@link import('./python-harvest.js').PythonHarvester} (the closest structural
 * sibling: implicit/keyword-delimited blocks, statement-modifier forms, a
 * begin/rescue/else/ensure exception model, and `case`/`when` + `case`/`in`
 * pattern matching). Like the Python / Kotlin harvesters, this unit emits the
 * per-function binding table ({@link BindingEntry}[]) plus {@link StatementFacts}
 * (defs / uses / mayDefs) AND a taint {@link import('../types.js').SiteRecord}
 * per call (callee path, receiver, per-arg occurrence entries, result defs,
 * spread marker, and an `at` anchor) via the shared
 * {@link CallSiteFactAccumulator} — the same site substrate the C-family / Go /
 * TS / Python / Kotlin / Dart harvesters emit.
 *
 * RUBY CALL SHAPE (verified by a real parse — see below). EVERY call in Ruby is
 * a single `call` node (fields `receiver`?/`method`/`arguments`?): a free call
 * `foo(a)`, an implicit-receiver paren-less command `puts x` / `attr_accessor :x`,
 * a member call `obj.method(x)`, a safe-navigation call `obj&.m()`, AND a chained
 * `a.b.c` (nested `call` receivers) are all `call` nodes. There is NO separate
 * `command` / `command_call` node in this vendored grammar — paren-less commands
 * normalize to `call` with a `method` + `arguments` and no `receiver`. Ruby has
 * NO `new` keyword (`Foo.new` is an ordinary member `call` with method `new`), so
 * every site is `kind: 'call'`. A receiver-only no-args `call` (`obj.field`,
 * `a.b`) is grammatically INDISTINGUISHABLE from a paren-less zero-arg member
 * call, and the Ruby CALLS query tags it `@reference.call.member` too — so it is
 * harvested as a `kind: 'call'` site (NOT a member-read), keeping the harvest
 * byte-aligned with what the resolver assigns a callee id. Named (symbol-keyed)
 * args (`f(k: v)` ⇒ a `pair` of `hash_key_symbol` + value) record the VALUE
 * occurrence and drop the key (like Python / Kotlin / Dart). A `do … end` / `{ }`
 * block is a nested function (opaque) — it is NOT an argument occurrence (the
 * `block` field is never walked here).
 *
 * ANCHOR ALIGNMENT (plan KTD7 — load-bearing): a call site's `at` MUST be the
 * SAME `[line (1-based), col (0-based)]` the Ruby CALLS resolution keys its
 * `atRange` on, because a downstream unit joins the two by EXACT position. The
 * Ruby scope query (query.ts) anchors `@reference.call.free` and
 * `@reference.call.member` on the WHOLE `call` node (the `@reference.name` method
 * identifier and `@reference.receiver` are SUB-tags, excluded from the anchor by
 * `KNOWN_SUB_TAGS` + the broadest-span rule in `anchorCaptureFor`). So for a free
 * call `foo(x)`, an implicit command `puts x`, a member call `obj.method(x)`, and
 * a chained call `a.b.c` alike, `at` is the start of the `call` node — which, for
 * a member/chained call, starts at the RECEIVER (`obj`/`a`), exactly where the
 * CALLS anchor starts too. This is the Go/Python/Kotlin whole-call-node model,
 * NOT the Dart callee-name model. The harvester records
 * `[node.startPosition.row + 1, node.startPosition.column]` of the `call` node.
 * (Verified byte-exact against the real Ruby query for every shape above.)
 *
 * Runs in the parse worker next to the Ruby CFG visitor.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-ruby via the introspection probe before use (mandatory pre-step).
 * Ruby shapes pre-empted (verified by a real parse):
 *  - functions: `method` / `singleton_method` (fields `name`/`parameters`/`body`;
 *    `parameters` is a `method_parameters`; `body` is a `body_statement`), and
 *    blocks `do_block` (`body` = `body_statement`) / `block` (`body` =
 *    `block_body`) / `lambda` (`body` = a `block` wrapping a `block_body`) — each
 *    has a `parameters` (`block_parameters` / `lambda_parameters`).
 *  - parameters: bare `identifier`, `optional_parameter` (fields `name`/`value`),
 *    `splat_parameter` / `hash_splat_parameter` / `block_parameter` /
 *    `keyword_parameter` (field `name`).
 *  - assignment: `assignment` (fields `left`/`right`; LHS may be `identifier`,
 *    `left_assignment_list` (multi `a, b = …`), `instance_variable` (`@x`),
 *    `class_variable` (`@@x`), `global_variable` (`$x`), `constant`),
 *    `operator_assignment` (fields `left`/`operator`/`right` — read+write).
 *  - binders: `for` (fields `pattern`/`value`=`in`/`body`), block `parameters`
 *    (`block_parameters` of identifier / optional / splat leaves), rescue
 *    `variable` (an `exception_variable` wrapping the bound `identifier`).
 *  - reads: `call` (fields `receiver`?/`method`/`arguments`), `binary` (fields
 *    `left`/`operator`/`right`), `parenthesized_statements`.
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the Python / TS / Go
 * harvesters): the CFG walk is NOT source-order, so resolving names against a
 * scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once, declaring every in-function local name; phase
 * 2 resolves defs/uses against that finished table from any walk order.
 *
 * Ruby scope model (deliberately simplified, documented): Ruby binds LOCAL
 * variables on first assignment; block parameters and block-local variables have
 * their own block scope, but — exactly as the Python harvester declares all
 * targets in a SINGLE function table (a documented over-approximation) — this
 * harvester declares every assignment / for / block-param / rescue-variable /
 * method-param target into one function-scope table. Instance/class/global
 * variables (`@x` / `@@x` / `$x`) and bare constants are NOT local variables: a
 * read or write of one is recorded as a use only (an attribute-like write — its
 * "name" is not a function-scoped scalar def), matching the TS/Python member-
 * write exclusion. A bare method call with no parens (`foo`) is indistinguishable
 * from a local read at this layer; we resolve such an identifier against the
 * local table and only mint a SYNTHETIC module binding when it is unknown (the
 * conservative direction — a real method call resolves to a `module` synthetic,
 * never a false local def).
 *
 * v1 def-semantics scope:
 *   - `assignment` plain `=` — each `identifier` target in the (possibly
 *     `left_assignment_list`) LHS is a def; an `@x`/`@@x`/`$x`/`Const` target or
 *     an index/attribute target is NOT a scalar def (root is a use only).
 *   - `operator_assignment` (`x += 1`, `x ||= y`) — def AND use the lvalue.
 *   - `for x in xs` / `for a, b in xs` — the loop target(s) are defs; `xs` a use.
 *   - block params (`|x|`, `|x, y|`, `|*rest|`) — `param`-kind defs.
 *   - `rescue ... => e` — `e` is a `catch`-kind def (matters to the taint pass).
 *   - method parameters (incl. defaults, `*splat`, `**kwsplat`, `&block`,
 *     keyword) — `param`-kind defs.
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression is a may-def
 * (gen WITHOUT kill), so the not-taken path's prior def is not falsely killed.
 * Ruby's conditional-def shapes: an assignment in the right operand of `&&`/`and`
 * / `||`/`or` short-circuit (`a && (x = 1)`), and a `when`/`in` case-test
 * expression / `in`-clause guard (a later case only evaluates when earlier
 * patterns did not match).
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class RubyHarvester {
    private readonly fnNode;
    private readonly bindings;
    /** Single function-scope name → binding index (documented over-approximation). */
    private readonly table;
    private readonly synthetic;
    private readonly fnId;
    /** >0 while walking a conditionally-evaluated subexpression — defs become may-defs. */
    private conditionalDepth;
    /**
     * `call` node id → binding indices its single-target result is assigned to
     * (`x = f()` ⇒ `[x]`). Populated just before the value walk reaches the call
     * (see {@link registerResultDefs}) and consumed by {@link visitCall}. Mirrors
     * the Python / Kotlin / Go harvesters' `resultDefTargets`.
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The function/block/lambda body node. */
    private bodyOf;
    private declare;
    /** Declare every parameter binder (method / block / lambda). */
    private declareParams;
    /** The `parameters` field (or first parameter-container child) of a function node. */
    private paramsOf;
    /** Declare the binder identifier of one parameter node. */
    private declareParam;
    /**
     * Pre-scan the function body once, declaring every in-function local name.
     * Recurses into compound statements but NOT into nested function/block/lambda
     * bodies (opaque).
     */
    private prescan;
    /** `rescue [Exc] => e` — declare `e` (a `catch`-kind def). */
    private declareRescueVar;
    /** Declare identifier leaves of an assignment / loop target (skip non-local LHS). */
    private declareTargets;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (case tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for PATTERN in VALUE` head: the loop target(s) are defs, the
     * iterated expression is a use.
     */
    loopHeadFacts(forNode: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position assignment (`x = if … / case …`, #2205):
     * just the LHS target(s), attached to the continuation block the branch arms
     * rejoin. The branch condition + arm-value USES are harvested onto the branch's
     * own blocks (visitIf / visitCase), so this must not re-walk the RHS.
     */
    assignmentDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /** Facts for a `rescue [Exc] => e` header: `e` is a def, the exception list a use. */
    rescueHeadFacts(clause: SyntaxNode): StatementFacts;
    /** ENTRY-block facts for the parameters (defs only — incl. default-value uses). */
    paramFacts(): StatementFacts | undefined;
    /** Def the binder of one parameter node and use any default-value expr. */
    private defParam;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /**
     * Def each identifier leaf of an assignment / loop target; route non-local
     * targets (`@x`, index/attribute writes) to the value walk (root is a use).
     */
    private defTargets;
    /** Value-position walk: collect uses; route def positions to the target handler. */
    private walkValue;
    /**
     * When `value` is a `call`, remember that call site should carry `resultDefs`
     * — the binding indices of `targets` (def-position identifiers). Consumed by
     * {@link visitCall} once the value walk reaches the node. Single plain-identifier
     * target only (the caller restricts to it); the blank target (`_`) binds nothing
     * and is skipped.
     */
    private registerResultDefs;
    /**
     * Explicit `call` handler. Records a call site (callee path, receiver, per-arg
     * occurrence entries, result defs, spread marker) while reproducing EXACTLY the
     * uses the old default descent recorded (receiver chain root + arguments). Ruby
     * has no `new` — every site is `kind: 'call'`. The `at` anchor is the `call`
     * node's start, byte-aligned with the `@reference.call.free/.member` CALLS
     * anchor (which captures the whole `call` node), so the resolved-id join lands
     * by exact position (see file header ANCHOR ALIGNMENT).
     */
    private visitCall;
    /**
     * Walk a member-call receiver, returning the chain ROOT binding (recorded as a
     * use) and the dotted prefix path (`a.b` in `a.b.c()`), plus a member-read site
     * for each NON-final access in the chain. A receiver that is itself a `call`
     * (Ruby nests `a.b.c` as `call(call(a,b),c)`) recurses; a bare identifier root
     * is the receiver binding; a `self` / non-identifier root has no static path.
     */
    private walkReceiverChain;
    /** Dotted callee path `prefix.method` (or undefined when the prefix is opaque). */
    private calleePath;
    /**
     * Walk an `argument_list`, tagging each positional / keyword / splat argument's
     * occurrence position. A `pair` (`k: v`) records only the VALUE occurrence (the
     * `hash_key_symbol` key is not a use). A `splat_argument` (`*xs`) /
     * `hash_splat_argument` (`**kw`) marks the first spread position so the matcher
     * degrades soundly; its inner value still walks. A `block_argument` (`&blk`)
     * passes a block — its inner value is a use occurrence.
     */
    private walkArguments;
}
