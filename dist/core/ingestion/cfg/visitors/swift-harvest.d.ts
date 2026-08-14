/**
 * Swift def/use harvester (#2195) — the Swift analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the C-family / Go /
 * Rust / Kotlin / Python harvesters. Like the Kotlin / Go / Python / Dart
 * harvesters it harvests the per-function binding table ({@link BindingEntry}[])
 * plus {@link StatementFacts} (defs / uses / mayDefs) AND a taint
 * {@link import('../types.js').SiteRecord} per call (callee path, receiver,
 * per-arg occurrence entries, result defs, and an `at` anchor) via the shared
 * {@link CallSiteFactAccumulator} — the same site substrate the C-family / Go /
 * TS / Kotlin / Python / Dart harvesters emit.
 *
 * SWIFT CALL SHAPE (verified by a real parse — see below; structurally identical
 * to Kotlin). A call is a `call_expression` whose LAST child is a `call_suffix`
 * (holding the `value_arguments` and/or a trailing closure `lambda_literal`); the
 * callee is the preceding expression — a bare `simple_identifier` (`foo(...)`)
 * for a FREE call, or a `navigation_expression` (`obj.method` / `a?.b`, fields
 * `target`/`suffix`→`navigation_suffix`→`suffix`:`simple_identifier`) for a
 * MEMBER call. A chained call `a.b.c()` nests `navigation_expression`s; the
 * receiver is the chain ROOT binding (`self`/literal roots launder no taint —
 * no receiver). Swift has no `new` — an init call `Foo(...)` is an ordinary
 * `call_expression` with a `simple_identifier` callee, so every site is
 * `kind: 'call'` (the CALLS query re-tags an UpperCamelCase callee
 * `@reference.call.constructor`, but the harvester only needs callee + receiver
 * + `at` right — `kind` is not joined). A `value_argument` carries its value in
 * the `value` field; a labeled arg's `value_argument_label` (`name:`) is dropped,
 * so only the value occurrence is recorded (an `&inout` value walks its target
 * for the use). Trailing closures (`xs.map { … }`) are a nested `lambda_literal`
 * — opaque (in {@link NESTED_FUNCTION_TYPES}), NOT an argument occurrence.
 *
 * ANCHOR ALIGNMENT (plan KTD7 — load-bearing): a call site's `at` MUST be the
 * SAME `[line (1-based), col (0-based)]` the Swift CALLS resolution keys its
 * `atRange` on, because a downstream unit joins the two by EXACT position. The
 * Swift scope query (query.ts) anchors `@reference.call.free`,
 * `@reference.call.member`, and `@reference.call.constructor` on the WHOLE
 * `call_expression` node (the `@reference.name` simple_identifier and the
 * `@reference.receiver` are SUB-tags, excluded from the anchor by
 * `KNOWN_SUB_TAGS` + the broadest-span rule in `anchorCaptureFor`; the
 * constructor re-tag at `captures.ts` reuses the same call_expression node, and
 * `atRange: anchor.range` at scope-extractor.ts:1030). So for a free call
 * `foo(x)`, a member call `obj.method(x)`, a chained call `a.b.c(x)`, and an init
 * call `Foo(x)` alike, `at` is the start of the enclosing `call_expression` node
 * — which, for a member/chained call, starts at the RECEIVER (`obj`/`a`), exactly
 * where the CALLS anchor starts too. This is the Kotlin/Go/Python whole-call-node
 * model, NOT the Dart callee-name model. `visitCall` receives exactly the
 * `call_expression` node and records `[node.startPosition.row + 1,
 * node.startPosition.column]`.
 *
 * Runs in the parse worker next to the Swift CFG visitor. Output is the binding
 * table the {@link import('../cfg-builder.js').CfgBuilder} stamps onto the CFG,
 * plus the per-block def/use facts the reaching-defs / CDG solvers consume.
 *
 * Every node type and field literal below was grammar-validated against the
 * VENDORED tree-sitter-swift via the introspection probe before use (mandatory
 * pre-step). Swift shapes pre-empted (verified by a real parse):
 *  - functions: `function_declaration` / `init_declaration` / `deinit_declaration`
 *    (field `body`=`function_body`, which wraps a `statements` node) and
 *    `lambda_literal` (a closure — its `statements` follow an optional
 *    `lambda_function_type` + `in`, NO `function_body` wrapper).
 *  - parameters: `parameter` (fields `external_name`?/`name`=`simple_identifier`,
 *    plus a type child). A closure's parameters live in `lambda_function_type` →
 *    `lambda_function_type_parameters` (bare `simple_identifier`s).
 *  - `property_declaration` — Swift's `let`/`var` binding: a `value_binding_pattern`
 *    (`mutability` = `let`/`var`), then repeated `name`=`pattern` + `value`= pairs
 *    (`let p = 1, q = 2`). A `pattern` binds via `bound_identifier`=`simple_identifier`
 *    or nests `pattern`s for tuple destructuring (`let (a, b) = pair`).
 *  - optional binding (`if let` / `while let` / `guard let`): a `value_binding_pattern`
 *    in the construct's `condition` fields, then a `bound_identifier` field and the
 *    bound value as further `condition` fields.
 *  - `for_statement` fields `item`=`pattern` / `collection` / optional `where_clause`.
 *  - `catch_block` field `error`=`pattern` (the bound error).
 *  - reads: `simple_identifier`, `navigation_expression` (`a.b` — fields
 *    `target`/`suffix`), `call_expression` (`f()` — `call_suffix`),
 *    `assignment` (fields `target`/`operator`/`result`).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the Rust / Go / C
 * harvesters): the CFG walk is NOT source-order (`repeat … while` builds the
 * condition after the body), so resolving names against a scope stack populated
 * *during* the walk would mis-resolve. Phase 1 pre-scans the whole function
 * subtree once, declaring every bound name into ONE function table; phase 2
 * resolves defs/uses against that finished table from any walk order. Swift DOES
 * have block scope + shadowing, but a single function table is the documented v1
 * simplification used by the Python / Rust harvesters — distinct shadowing
 * redeclarations of the same name collapse onto one binding (an over-approximation
 * that can falsely kill across a shadow, the sound direction for taint).
 *
 * v1 def-semantics scope:
 *   - `property_declaration` (`let`/`var PAT = …`) — each `simple_identifier`
 *     leaf of every `name` pattern is a def; the values are walked for uses.
 *   - `assignment` plain `=` — a plain-identifier target is a def; a
 *     `navigation_expression` / subscript target (`self.x = …`, `a[i] = …`) is
 *     NOT a scalar def (its root is a use). A compound `+=`/`-=`/… target
 *     def-AND-uses the lvalue.
 *   - `for x in xs` — the loop pattern's leaves are defs, the collection a use.
 *   - optional binding (`if let` / `while let` / `guard let`) binds its pattern.
 *   - `catch_block`'s `error` pattern binds.
 *   - parameters (incl. closure params) are `param`-kind defs.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): member / subscript writes
 * (`obj.f = …`, `a[i] = …`) are NOT scalar defs — their root identifiers are
 * uses only. Nested-function bodies (`lambda_literal`, a nested
 * `function_declaration`) are opaque in BOTH directions (captured reads/writes
 * invisible).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` short-circuit, and a switch-case `where` guard / case
 * test — is a may-def (gen WITHOUT kill), so the not-taken path's prior def is
 * not falsely killed. A `while let` re-test binding is also a may-def (the bind
 * does not happen on the exit iteration).
 *
 * Identifiers with no in-function declaration (module/global functions, types,
 * enum cases) resolve to a SYNTHETIC module-level binding (`name@module`),
 * applied identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class SwiftHarvester {
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
     * assigned to (`let x = f()` / `x = g()` ⇒ `[x]`). Populated just before the
     * value walk reaches the call (see {@link registerResultDefs}) and consumed by
     * {@link visitCall}. Mirrors the Kotlin / Go / Python harvesters' map.
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /**
     * The function/closure body `statements` node. A `function_declaration` /
     * `init_declaration` / `deinit_declaration` wraps it in a `function_body`; a
     * `lambda_literal` carries the `statements` directly.
     */
    private bodyOf;
    private declare;
    /** Declare every parameter binder of a fn / init / closure. */
    private declareParams;
    private declareClosureParams;
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested `function_declaration` /
     * `lambda_literal` bodies (opaque).
     */
    private prescan;
    /** Declare the bindings of each optional binding in a condition. */
    private declareOptionalBindings;
    /**
     * Declare every `simple_identifier` leaf of a binding pattern. Handles the
     * common Swift pattern shapes: a `bound_identifier` simple pattern and tuple
     * destructuring (`(a, b)`), which nests `pattern` children. `_` (the wildcard)
     * binds nothing.
     */
    private declarePattern;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (guards/tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Def-ONLY facts for a value-position binding carrier (`let x = if … / switch …`,
     * #2207): just the declared name pattern's leaves, attached to the continuation
     * block the branch arms rejoin. The condition + arm-value USES are already
     * harvested onto the branch's own blocks (visitIf / visitSwitch), so this must
     * NOT re-walk the value — only the `name`-field pattern leaves are defs here.
     */
    bindingDefFacts(stmt: SyntaxNode): StatementFacts | undefined;
    /**
     * MAY-def facts for a `switch_pattern`'s value bindings (`case let n` /
     * `case .some(let v)`). The binding only takes effect when the case matches,
     * so it is a may-def on the dispatch block — propagated into the case body
     * where the bound name is read.
     */
    switchPatternFacts(switchPattern: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for item in COLLECTION` head: the loop pattern's leaves are
     * defs, the iterated collection a use. The `where` guard (if any) is harvested
     * conditionally.
     */
    forHeadFacts(stmt: SyntaxNode): StatementFacts;
    /**
     * Facts for an `if`/`while`/`guard` condition: optional bindings bind their
     * pattern (a def — a may-def when `conditional`), and the condition expression
     * children are uses. The construct's `condition` / `bound_identifier` fields are
     * interleaved, so we walk all children and classify them.
     */
    conditionFacts(stmt: SyntaxNode, conditional: boolean): StatementFacts;
    /** ENTRY-block facts for the parameters (defs only). */
    paramFacts(): StatementFacts | undefined;
    /** Def fact for a `catch let e` error pattern — prepend to the handler entry block. */
    catchErrorFacts(catchBlock: SyntaxNode): StatementFacts | undefined;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /**
     * Def each `simple_identifier` leaf of a binding pattern (the def-position
     * analogue of {@link declarePattern}). Tuple destructuring recurses; `_` binds
     * nothing.
     */
    private defPattern;
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    private walkValue;
    /** Strip a `directly_assignable_expression` wrapper around an lvalue. */
    private unwrapAssignable;
    /**
     * The sole `bound_identifier` binder of a single `name` pattern, or undefined
     * when there are multiple `name` patterns or the pattern is a tuple / wildcard
     * destructuring (`let (a, b) = …`). Used to gate single-target result-defs.
     */
    private singlePatternBinder;
    /**
     * When `value`'s root (after unwrapping) is a `call_expression`, remember that
     * call site should carry `resultDefs` — the binding indices of `targets`
     * (def-position identifiers). Consumed by {@link visitCall} once the value walk
     * reaches the node. Single-target only; the blank target (`_`) binds nothing.
     */
    private registerResultDefs;
    /**
     * The callee node of a `call_expression` — the first named child that is NOT
     * the trailing `call_suffix` (a bare `simple_identifier` for a free / init
     * call, or a `navigation_expression` for a member / chained call).
     */
    private calleeOf;
    /**
     * Open + populate a call site for a Swift `call_expression`. `node` IS the
     * `call_expression` — the SAME node the scope query anchors `@reference.call.*`
     * on (its `atRange`), so the resolved-id join lands by exact position (see file
     * header ANCHOR ALIGNMENT). Swift has no `new`, so every site is `kind: 'call'`.
     */
    private visitCall;
    /**
     * Walk a `call_suffix`'s `value_arguments`, tagging each positional / labeled
     * argument's occurrence position. A trailing closure (`lambda_literal`) is a
     * nested function body — opaque (excluded by {@link NESTED_FUNCTION_TYPES}), so
     * it is not an argument occurrence here.
     */
    private walkArguments;
    /**
     * `navigation_expression` chain walk shared by value position and callee
     * position. Records the chain-root identifier as a use plus at most ONE
     * member-read site — the INNERMOST access — when the root is an identifier;
     * `skipFinalRead` suppresses it when that access is the callee (carried by the
     * dotted path instead). Mirrors the Kotlin / Go / Python harvesters' walkChain.
     * A non-identifier root (`self`/literal/call) launders no static path/receiver.
     */
    private walkChain;
}
