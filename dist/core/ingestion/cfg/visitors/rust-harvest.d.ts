/**
 * Rust def/use harvester (#2195 U7) — the Rust analogue of
 * {@link import('./typescript-harvest.js').TsHarvester} and the C-family /
 * Go / Python / Swift / Kotlin / Dart harvesters. Like the Swift / Kotlin / Go /
 * Python / Dart harvesters it harvests the per-function binding table
 * ({@link BindingEntry}[]) plus {@link StatementFacts} (defs / uses / mayDefs)
 * AND a taint {@link import('../types.js').SiteRecord} per call (callee path,
 * receiver, per-arg occurrence entries, result defs, and an `at` anchor) via the
 * shared {@link CallSiteFactAccumulator} — the same site substrate the
 * C-family / Go / TS / Kotlin / Python / Dart / Swift harvesters emit, so Rust
 * BasicBlocks get `callees` + `calleeIds`.
 *
 * RUST CALL SHAPE (verified by a real parse — see the probe table below). Rust
 * has ONE call node, `call_expression { function, arguments }`, whose `function`
 * field takes three shapes:
 *  1. a bare `identifier` (`foo(x)`) — a FREE call; callee path = the name.
 *  2. a `field_expression { value, field }` (`a.method(x)`) — a METHOD call
 *     (the `.` access). The dotted path is `a.method` (leaf `method`); the
 *     receiver is the chain ROOT binding (`a`). Chained `a.b.c()` nests
 *     `field_expression`s (path `a.b.c`, root `a`, mid-chain read `a.b`).
 *  3. a `scoped_identifier { path, name }` (`Foo::bar(x)` / `a::b::c(x)`) — an
 *     associated-fn / path call. The path is joined with `.` (NOT `::`) so the
 *     LEAF after the last separator is the tail (`Foo::bar` ⇒ `Foo.bar` ⇒ leaf
 *     `bar`), exactly matching the Rust CALLS query, which tags this
 *     `@reference.call.free` with `@reference.name` = the tail `name:
 *     (identifier)` (`bar`), and matching how {@link
 *     import('../emit.js').calleesOfBlock} extracts the leaf via
 *     `callee.slice(callee.lastIndexOf('.') + 1)`. The receiver is set only when
 *     the path ROOT is a bound local (`a::b::c` with `a` a local ⇒ receiver `a`);
 *     a type/module root (`Foo`, `crate`) is not a value binding, so no receiver.
 *  4. a `generic_function { function, type_arguments }` (`foo::<T>(x)`) — the
 *     turbofish form; `visitCall` unwraps the `function` field and recurses, so
 *     `foo::<T>(x)` records the same site as `foo(x)`.
 * A `try_expression` (`foo()?`) wraps a `call_expression` — the inner call walks
 * normally.
 *
 * STRUCT LITERALS ARE HARVESTED AS `kind: 'new'` (U4). A struct-literal
 * expression `Point { x: 1 }` is a `struct_expression { name, body }`, NOT a
 * `call_expression`. The Rust CALLS query tags it `@reference.call.constructor`
 * (resolving to a constructor id), so `visitStruct` opens a `kind: 'new'` site
 * whose callee path is the struct TYPE name (`mymod::Point` ⇒ dotted `mymod.Point`
 * ⇒ leaf `Point`, the SAME tail the `@reference.name` capture resolves) and whose
 * `at` is the `struct_expression` start (== the broadest-span
 * `@reference.call.constructor` anchor — verified byte-equal for plain / scoped /
 * turbofish / scoped+turbofish forms). The `name` field shapes are
 * `type_identifier` (`Point`), `scoped_type_identifier` (`mymod::Point`), and
 * `generic_type_with_turbofish` (`Foo::<T>` / `mymod::Bar::<T>`); all start at the
 * same column as the `struct_expression`, so the anchor aligns. The struct's
 * type/module head is no value binding ⇒ no receiver. Field-init VALUES
 * (`field_initializer` `value`, shorthand `y`, base `..rest`) walk for
 * uses/occurrences; field NAMES are not uses.
 *
 * MACROS ARE NOT HARVESTED. `println!(...)` / `vec!(...)` are `macro_invocation`
 * nodes (a `macro` ident + a `token_tree`), NOT `call_expression`s. The Rust
 * CALLS query tags them `@reference.macro` (a DISJOINT namespace resolved via the
 * MacroRegistry to Macro defs, never a fn of the same name) — NOT
 * `@reference.call.*`. So no resolved callee-id is keyed at a macro's position,
 * and opening a call site there would put a leaf (`println`) into `callees` that
 * the resolution side never produces — a spurious, unjoinable callee. We
 * therefore record NO site for a macro (its argument identifiers still walk for
 * uses via the default token-tree descent), keeping `callees` aligned with the
 * CALLS resolution.
 *
 * ANCHOR ALIGNMENT (plan KTD7 — load-bearing): a call site's `at` MUST be the
 * SAME `[line (1-based), col (0-based)]` the Rust CALLS resolution keys its
 * `atRange` on, because a downstream unit joins the two by EXACT position. The
 * Rust scope query (captures.ts) anchors `@reference.call.free` (free + scoped),
 * `@reference.call.member`, and `@reference.call.constructor` on the WHOLE
 * `call_expression` node (the `@reference.name` identifier / `field_identifier`
 * and the `@reference.receiver` are SUB-tags in `KNOWN_SUB_TAGS`, excluded by the
 * broadest-span rule in `anchorCaptureFor`; `atRange: anchor.range` at
 * scope-extractor.ts:1030). So for a free call `foo(x)`, a method call
 * `a.method(x)`, a path call `Foo::bar(x)`, and a chained call `a.b.c(x)` alike,
 * `at` is the start of the enclosing `call_expression` node — which, for a
 * method/chained call, starts at the RECEIVER (`a`), and for a path call at the
 * head segment (`Foo`), exactly where the CALLS anchor starts too. This is the
 * Swift / Go / Python / Kotlin whole-call-node model, NOT the Dart callee-name
 * model. `visitCall` receives exactly the `call_expression` node and records
 * `[node.startPosition.row + 1, node.startPosition.column]`.
 *
 * Runs in the parse worker next to the Rust CFG visitor. Output is the binding
 * table the {@link import('../cfg-builder.js').CfgBuilder} stamps onto the CFG,
 * plus the per-block def/use facts the reaching-defs / CDG solvers consume.
 *
 * Every node type and field literal below was grammar-validated against
 * tree-sitter-rust via the introspection probe before use (mandatory pre-step).
 * Rust shapes pre-empted (verified by a real parse):
 *  - functions: `function_item` (fields `name`/`parameters`/`return_type`/`body`;
 *    methods are `function_item` inside an `impl_item`'s `declaration_list`) and
 *    `closure_expression` (field `parameters`=`closure_parameters`, `body` is a
 *    `block` OR a bare expression).
 *  - parameters: `parameter` (field `pattern`, optional `mutable_specifier`),
 *    `self_parameter`. A `closure_parameters` lists bare `identifier`s and/or
 *    `parameter` nodes.
 *  - declarations: `let_declaration` (field `pattern`, optional `value`, optional
 *    `alternative` block for `let … else`; optional `mutable_specifier`). The
 *    `mut` keyword is irrelevant to def-ness.
 *  - patterns (each bound `identifier` leaf is a def): `identifier`,
 *    `tuple_pattern`, `slice_pattern`, `struct_pattern` (`field_pattern`s whose
 *    `name` is a `shorthand_field_identifier`, or `name: pat`), `tuple_struct_pattern`
 *    (field `type` is the variant path — NOT a binding; the inner patterns bind),
 *    `ref_pattern` / `mut_pattern` (the inner identifier binds), `captured_pattern`
 *    (`v @ subpat` — `v` binds, and the subpattern's leaves bind), `or_pattern`,
 *    `range_pattern` (binds nothing). The wildcard `_` binds nothing.
 *  - assignments: `assignment_expression` (fields `left`/`right`),
 *    `compound_assignment_expr` (fields `left`/`operator`/`right` — read+write).
 *  - loop / match binders: `for_expression` `pattern`; `match_arm` `pattern`
 *    (a `match_pattern` whose leaves bind, plus an optional `if` guard with field
 *    `condition`); `let_condition` `pattern` (`if let` / `while let`).
 *  - reads: `field_expression` (fields `value`/`field`), `call_expression`
 *    (fields `function`/`arguments`), `binary_expression` (fields
 *    `left`/`operator`/`right`), `try_expression` (`expr?`).
 *
 * TWO-PHASE, ORDER-INDEPENDENT (load-bearing — mirrors the TS / Go / C
 * harvesters): the CFG walk is NOT source-order, so resolving names against a
 * scope stack populated *during* the walk would mis-resolve. Phase 1 pre-scans
 * the whole function subtree once, declaring every bound name into ONE function
 * table; phase 2 resolves defs/uses against that finished table from any walk
 * order. Rust DOES have block scope + shadowing, but a single function table is
 * the documented v1 simplification used by the Python harvester — distinct
 * shadowing redeclarations of the same name collapse onto one binding (an
 * over-approximation that can falsely kill across a shadow, the sound direction
 * for taint: never a missed flow).
 *
 * v1 def-semantics scope:
 *   - `let PAT = …` (and `let PAT = … else { … }`) — each identifier leaf of PAT
 *     is a def; the value (and the `else` block) are walked for uses.
 *   - `assignment_expression` plain `=` — a plain-identifier lvalue is a def; a
 *     `field_expression` / index lvalue is NOT a scalar def (its root is a use).
 *   - `compound_assignment_expr` (`x += 1`) — def AND use the lvalue.
 *   - `for PAT in ITER` — the loop pattern's leaves are defs, ITER a use.
 *   - `match` arm patterns bind their leaves; `if let` / `while let` patterns bind.
 *   - parameters (incl. `mut`, typed, closure params) are `param`-kind defs.
 * EXCLUDED, deliberately (TypeScript-CFA precedent): field / index writes
 * (`obj.f = …`, `arr[i] = …`) are NOT scalar defs — their root identifiers are
 * uses only. Nested-function bodies (`closure_expression`, an inner
 * `function_item`) are opaque in BOTH directions (captured reads/writes invisible).
 *
 * MAY-DEFS: a def inside a conditionally-evaluated subexpression — the right
 * operand of `&&` / `||` short-circuit, and a match-arm guard / `if let` pattern
 * test — is a may-def (gen WITHOUT kill), so the not-taken path's prior def is
 * not falsely killed. (Rust assignment is an expression but yields `()`, so an
 * in-`&&` assignment is rare; the machinery is kept for guard / case-test parity.)
 *
 * Identifiers with no in-function declaration (module items, imported names,
 * constants, enum variants) resolve to a SYNTHETIC module-level binding
 * (`name@module`), applied identically by def and use harvesting.
 *
 * NOTE: nothing serialized here may carry a field named `nodeId` — the durable
 * parsedfile-store reviver dedups objects keyed on that field name.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
import type { BindingEntry, StatementFacts } from '../types.js';
export declare class RustHarvester {
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
     * {@link visitCall}. Mirrors the Swift / Kotlin / Go / Python harvesters' map.
     */
    private readonly resultDefTargets;
    constructor(fnNode: SyntaxNode);
    /** The completed binding table — pass to `CfgBuilder.finish`. */
    bindingTable(): readonly BindingEntry[];
    /** The function/closure body node (a `block` for a fn, block-or-expr for a closure). */
    private bodyOf;
    private declare;
    /** Declare every parameter binder of a fn / closure (incl. `mut`, typed). */
    private declareParams;
    /**
     * Pre-scan the function body once, declaring every bound name. Recurses into
     * compound expressions but NOT into nested `function_item` / `closure_expression`
     * bodies (opaque).
     */
    private prescan;
    /**
     * Declare every identifier leaf of a binding pattern. Handles the full Rust
     * pattern taxonomy: tuple / slice / struct / tuple-struct / ref / mut /
     * captured (`@`) / or patterns. A `tuple_struct_pattern`'s `type` field is the
     * variant PATH (`Some`, `Ok`) — not a binding; only its inner patterns bind.
     * `_`, literals and range patterns bind nothing.
     */
    private declarePattern;
    /** `field_pattern` — shorthand `x` binds `x`; `x: pat` binds `pat`'s leaves. */
    private declareFieldPattern;
    /** Def/use facts for one statement (or construct-header expression) node. */
    facts(node: SyntaxNode): StatementFacts;
    /** Facts for an expression whose WHOLE evaluation is conditional (guards/tests). */
    factsConditional(node: SyntaxNode): StatementFacts;
    /**
     * Facts for a `for PAT in ITER` head: the loop pattern's leaves are defs, the
     * iterated expression a use.
     */
    forHeadFacts(stmt: SyntaxNode): StatementFacts;
    /**
     * Facts for ONLY a `let_declaration`'s PATTERN bindings (no value walk) — used
     * when the value is a control-flow expression already harvested by the visitor,
     * so the binding defs land on a separate continuation block without
     * double-counting the value's uses.
     */
    letPatternFacts(stmt: SyntaxNode): StatementFacts;
    /**
     * Facts for a `let PAT = VALUE` condition (`if let` / `while let`): the value
     * is a use, the pattern's leaves are defs. When `conditional` is true the defs
     * become may-defs (a `while let` re-test may not bind on the exit iteration).
     */
    letConditionFacts(cond: SyntaxNode, conditional: boolean): StatementFacts;
    /**
     * Facts for a `match` arm's PATTERN bindings (#2206): `Some(n) => …` binds `n`
     * from the matched subject. The bindings are MAY-defs (only the arm that
     * actually matches binds; a later arm tests only when earlier ones didn't) and
     * are attached to the dispatch block, co-located with the subject's use, so a
     * tainted subject can propagate to the arm binding. The guard is skipped by
     * {@link defPattern}'s `match_pattern` handling. `undefined` when the pattern
     * binds nothing (`_`, a literal, a unit variant).
     */
    matchArmPatternFacts(arm: SyntaxNode): StatementFacts | undefined;
    /** ENTRY-block facts for the parameters (defs only — incl. default-position uses). */
    paramFacts(): StatementFacts | undefined;
    private resolve;
    private def;
    private use;
    /** Run `fn` with defs demoted to may-defs (conditionally-evaluated context). */
    private conditional;
    /**
     * Def each identifier leaf of a binding pattern (the def-position analogue of
     * {@link declarePattern}). A `tuple_struct_pattern`'s `type` field path is a
     * variant name, not a def; its inner patterns bind. A struct field shorthand
     * binds; `_` binds nothing.
     */
    private defPattern;
    private defFieldPattern;
    /** Value-position walk: collect uses; route def positions to the pattern handler. */
    private walkValue;
    /**
     * When `value`'s root (after unwrapping a `try_expression`) is a
     * `call_expression`, remember that call site should carry `resultDefs` — the
     * binding indices of `targets` (def-position identifiers). Consumed by
     * {@link visitCall} once the value walk reaches the node. Single-target only;
     * the blank target (`_`) binds nothing.
     */
    private registerResultDefs;
    /** Strip a `try_expression` (`expr?`) / `await_expression` wrapper around a value. */
    private unwrapValue;
    /**
     * Open + populate a call site for a Rust `call_expression`. `node` IS the
     * `call_expression` — the SAME node the scope query anchors `@reference.call.*`
     * on (its `atRange`), so the resolved-id join lands by exact position (see file
     * header ANCHOR ALIGNMENT). A `call_expression` is always `kind: 'call'`; struct
     * literals (`kind: 'new'`) are harvested separately by {@link visitStruct}.
     */
    private visitCall;
    /**
     * Open + populate a `kind: 'new'` site for a Rust `struct_expression`
     * (`Point { x: 1 }`, `mymod::Point { .. }`, `Foo::<T> { .. }`). `node` IS the
     * `struct_expression` — the SAME node the Rust scope query anchors
     * `@reference.call.constructor` on (its `atRange`), so the resolved
     * constructor-id join lands by exact position. The `name` field of a
     * `struct_expression` is a `type_identifier` (`Point`), a
     * `scoped_type_identifier` (`mymod::Point`), or a `generic_type_with_turbofish`
     * (`Foo::<T>` / `mymod::Bar::<T>`); all three start at the SAME column as the
     * enclosing `struct_expression` (verified by a real parse), so the broadest-span
     * `@reference.call.constructor` anchor == the `struct_expression` start.
     *
     * The callee path joins the `::`-segments of the type with `.` (NOT `::`) so the
     * LEAF after the last separator is the tail (`mymod::Point` ⇒ `mymod.Point` ⇒
     * leaf `Point`), exactly the tail the CALLS query's `@reference.name` capture
     * resolves and the tail {@link import('../emit.js').calleesOfBlock} extracts via
     * `lastIndexOf('.')`. A type/module path head is never a value binding, so no
     * receiver (mirrors {@link harvestScopedCallee}). The field-init VALUES
     * (`field_initializer` `value`, shorthand `y`, base `..rest`) walk for
     * uses/occurrences; field NAMES are not uses.
     */
    private visitStruct;
    /**
     * Build the dotted type path of a `struct_expression`'s `name` field. The name
     * is a `type_identifier` (`Point`), a `scoped_type_identifier`
     * (`mymod::Point` — `path` + tail `name` type_identifier), or a
     * `generic_type_with_turbofish` (`Foo::<T>` / `mymod::Bar::<T>` — its `type`
     * field is a `type_identifier` or a `scoped_identifier`; the turbofish
     * `type_arguments` are dropped). Segments join with `.` so the leaf is the type
     * tail (matching the CALLS `@reference.name` tail capture). Returns `undefined`
     * when no segments could be read (defensive — keeps a mis-anchored site from
     * carrying a bogus callee).
     */
    private structTypePath;
    /**
     * Record the callee path + receiver for a `call_expression`'s `function` node.
     * Free `identifier` (`foo`), method `field_expression` (`a.method`, receiver
     * root `a`), path `scoped_identifier` (`Foo::bar` ⇒ dotted `Foo.bar`, leaf
     * `bar`), and the turbofish `generic_function` (`foo::<T>` — unwrap the
     * `function` field and recurse). Anything else (a call-rooted chain `f()()`,
     * a parenthesized callable) walks for uses with no static callee path.
     */
    private harvestCallee;
    /**
     * Walk a `scoped_identifier` (`Foo::bar`, `a::b::c`) callee. The `::`-segments
     * are joined with `.` (NOT `::`) so the LEAF after the last separator is the
     * tail (`Foo::bar` ⇒ `Foo.bar` ⇒ leaf `bar`), matching the Rust CALLS query's
     * `@reference.name` tail capture and {@link
     * import('../emit.js').calleesOfBlock}'s `lastIndexOf('.')` leaf rule. The
     * receiver is set only when the head segment is a bound LOCAL (`a::b::c` with
     * `a` a local); a type / module head (`Foo`, `crate`) is no value binding.
     */
    private harvestScopedCallee;
    /**
     * `field_expression` chain walk shared by value position and callee position.
     * Records the chain-root identifier as a use plus at most ONE member-read site
     * — the INNERMOST access — when the root is an identifier; `skipFinalRead`
     * suppresses it when that access is the callee (carried by the dotted path
     * instead). Mirrors the Swift / Kotlin / Go / Python harvesters' walkChain. A
     * non-identifier root (`self`/literal/call) launders no static path/receiver
     * but its uses + nested sites are still walked.
     */
    private walkChain;
}
