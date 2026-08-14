/**
 * Shadowed CommonJS export-assignment detection (issue #2723).
 *
 * The CJS declaration rules in the JS/TS scope queries bind the bare property
 * name of `exports.X = function () {}` / `module.exports.X = (a) => a` into the
 * enclosing module scope, so importers resolve to it by name. That is the whole
 * point of #2723 — without it the graph node exists and nothing resolves to it.
 *
 * But a file may ALSO declare that same name lexically:
 *
 *   function dup(v) { return v; }
 *   exports.dup = function (v) { return !v; };
 *   function callIt(v) { return dup(v); }
 *
 * Then the module scope holds TWO declarations named `dup`, the name is
 * ambiguous, and the resolver drops `callIt -> dup` altogether — an edge that
 * resolved fine before #2723. A silently missing caller is worse than the gap
 * #2723 set out to close, so the emitter drops the CJS declaration in exactly
 * this case: the lexical declaration already supplies the module-scope name,
 * so importers still resolve, and intra-module resolution is unchanged from
 * before #2723.
 *
 * Only the `@declaration.function` match is suppressed. The graph node comes
 * from a separate query (`tree-sitter-queries.ts`) and collapses onto the
 * lexical declaration's node by name anyway, so no node is lost.
 *
 * Shared by both the JavaScript and TypeScript capture emitters — every
 * grammar node named here (`assignment_expression`, `member_expression`,
 * `property_identifier`, `function_declaration`, `lexical_declaration`,
 * `variable_declaration`, `export_statement`) exists in both
 * `tree-sitter-javascript` and `tree-sitter-typescript`.
 *
 * Pure given the input nodes. No I/O, no globals; the cache is keyed on the
 * root node it derives from, so it cannot outlive its tree.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * True when `assignment` is a `this.X = <function>` at MODULE level — i.e. no
 * `this`-binding function encloses it — inside a CommonJS module, which makes
 * it an export of `X`.
 *
 * Arrow functions are transparent here: ECMA-262 gives an arrow
 * `[[ThisMode]] = lexical`, so a top-level arrow's `this` is still the
 * module's. Every other function form binds its own receiver and stops the
 * walk — that is an instance member, handled as a Method instead.
 */
/**
 * True when `assignment` is a `this.X = <callable>` at MODULE level, regardless
 * of module system.
 *
 * Distinct from {@link isModuleLevelThisExport}, which additionally requires the
 * file to be CommonJS. A module-level `this` member in ESM (or in a file with no
 * module-system signal) is neither an export nor an instance member — `this` is
 * `undefined` there — so it should produce nothing rather than an ownerless
 * `Method` node (#2729 review F13).
 */
export declare function isModuleLevelThisAssignment(assignment: SyntaxNode): boolean;
export declare function isModuleLevelThisExport(assignment: SyntaxNode, root: SyntaxNode, filePath?: string): boolean;
/** The property name of a module-level `this.X = fn` export, or null. */
export declare function moduleLevelThisExportName(assignment: SyntaxNode, root: SyntaxNode, filePath?: string): string | null;
/**
 * The name this assignment exports, or null when it exports nothing.
 *
 * Takes the VALUE node (the function literal) and the program root, because
 * alias resolution is a whole-file question. Used by the capture emitters to
 * keep the widened `<identifier>.X = fn` match only when the receiver really
 * is the exports object.
 */
export declare function cjsExportedNameFor(node: SyntaxNode, root: SyntaxNode): string | null;
/**
 * True when `node` is the value of a `this.X = fn` assignment that declares
 * NOTHING at module scope — either because a function encloses it (an instance
 * member, which gets a Method + owner edge instead) or because the file is not
 * CommonJS (top-level `this` is undefined in ESM).
 */
export declare function isUndeclarableThisMemberValue(node: SyntaxNode, root: SyntaxNode): boolean;
/**
 * True when `node` is the value of a `<identifier>.<member> = fn` assignment
 * whose receiver is NOT the exports object — the over-match the widened
 * member-assignment rule accepts so an `exports` alias can be recognised.
 *
 * Such a receiver declares nothing at module scope: `obj.handler = fn` binds a
 * property of `obj`, not a module symbol named `handler`. Prototype and `this`
 * receivers are not identifiers, so they never reach this guard and keep their
 * own (Method) treatment.
 */
export declare function isUnexportedMemberAssignmentValue(node: SyntaxNode, root: SyntaxNode): boolean;
/**
 * True when `node` (an `arrow_function` / `function_expression` /
 * `generator_function`) is the value of a CJS export assignment whose property
 * name is ALREADY declared at module scope of `root`.
 *
 * False for a CJS export whose name is declared only by the assignment (the
 * ordinary #2723 case — the declaration must be emitted), and false for
 * anything that is not a CJS export assignment at all.
 */
export declare function isShadowedCjsExportAssignment(node: SyntaxNode, root: SyntaxNode): boolean;
/**
 * The module-scope name this assignment value exports, across EVERY export
 * form — direct `exports.X`, `module.exports.X`, an alias receiver, a
 * module-level `this.X`, and the anonymous/named default export.
 *
 * One entry point so the shadow guard cannot silently miss a form. Previously
 * it consulted only the direct path: the alias path was skipped because `root`
 * was not forwarded, `this` never reached it at all, and the default export had
 * no check — three holes that each dropped a real call edge or, for the
 * default, fabricated a self-recursive one (#2729 review F3/F4).
 */
export declare function cjsExportedName(value: SyntaxNode, root: SyntaxNode): string | null;
/**
 * True when the DERIVED default-export name collides with a callable the module
 * already declares.
 *
 * `format.js` containing `function format() {}` plus an anonymous
 * `module.exports = function () { return format(v); }` merged both onto one
 * node, and the inner call to `format` then resolved to the merged node —
 * fabricating a self-recursion edge present in no source (#2729 review F4).
 * A fabricated edge is worse than a missing one: it misleads `impact` with a
 * caller that does not exist.
 */
export declare function defaultExportNameCollides(assignment: SyntaxNode, root: SyntaxNode, derivedName: string): boolean;
/**
 * Same question as {@link isShadowedCjsExportAssignment}, asked of the
 * ASSIGNMENT node rather than its value — the shape `provider.labelOverride`
 * receives, since the graph-node capture is anchored on the assignment.
 *
 * Used to drop the graph node too, not just the scope declaration. When the
 * shadowed name is a `function`, the node collapsed onto the lexical
 * declaration's node anyway (same label, same id), but a `class Dup {}` plus
 * `exports.Dup = function () {}` produced `Class:f:Dup` AND an orphan
 * `Function:f:Dup` — a node nothing can reach, because the declaration that
 * would have made it reachable is suppressed by the rule above.
 */
export declare function isShadowedCjsExportAssignmentNode(node: SyntaxNode, root: SyntaxNode): boolean;
