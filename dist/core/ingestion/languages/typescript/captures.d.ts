/**
 * `emitScopeCaptures` for TypeScript.
 *
 * Drives the TypeScript scope query against tree-sitter-typescript and groups
 * raw matches into `CaptureMatch[]` for the central extractor. Layers
 * synthesized streams on top:
 *
 *   1. **Import decomposition** — each `import_statement` / re-export is
 *      re-emitted with `@import.kind/source/name/alias/type-only` markers so
 *      `interpretTsImport` can recover the `ParsedImport` shape without
 *      re-parsing raw text (see `import-decomposer.ts`). Unit 2 adds this;
 *      until then, raw `@import.statement` matches flow through as-is.
 *   2. **Dynamic imports** — `import('./m')` is re-emitted as a
 *      decomposed `@import.statement` with `@import.kind=dynamic` so the
 *      central extractor treats it uniformly with static imports.
 *   3. **Function-decl arity metadata** (Unit 5) — `@declaration.parameter-count`
 *      / `@declaration.required-parameter-count` / `@declaration.parameter-types`
 *      synthesized onto function-like declarations so the registry can narrow
 *      overloads.
 *   4. **Callsite arity metadata** (Unit 5) — `@reference.arity` /
 *      `@reference.parameter-types` on every callsite.
 *   5. **Receiver-binding synthesis** (Unit 3) — `this` type anchors on
 *      instance methods, with arrow-function lexical-this walk-up.
 *
 * Pure given the input source text. No I/O, no globals consulted.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/** tree-sitter-typescript node types for function-like scopes that may
 *  carry a synthesized `this` binding. Kept in sync with the
 *  `@scope.function` patterns in `query.ts`. */
export declare const FUNCTION_NODE_TYPES: readonly ["method_definition", "method_signature", "abstract_method_signature", "arrow_function", "function_expression", "function_declaration", "generator_function_declaration", "generator_function", "function_signature"];
/** The class-field declaration node a field `@type-binding.*` match anchors on
 *  in TypeScript/TSX. JavaScript spells the same construct `field_definition`
 *  and passes its own set in — the predicate below is shared because both
 *  grammars carry `static` identically, but each language must NAME its own
 *  node type. Listing both here made `field_definition` a dead literal in the
 *  typescript grammar, which `grammar-literal-validation` fails on: the gate
 *  checks every literal against the grammar of the FILE it appears in, and a
 *  node type that is dead there is exactly how a guard silently stops firing. */
export declare const TS_CLASS_FIELD_DEFINITION_TYPES: ReadonlySet<string>;
/**
 * Is this type-binding anchored on a **`static`** class field?
 *
 * A static member belongs to the CLASS OBJECT; an instance field belongs to
 * instances. JavaScript and TypeScript keep the two in separate namespaces, so
 * one class may legally declare both under one name:
 *
 *     class Host {
 *       p = new Right();
 *       static p = new Wrong();      // legal — a different member
 *       hit() { return this.p.hit(); }   // `this.p` is Right
 *     }
 *
 * Both field patterns anchor their binding on the same CLASS scope with the
 * same `constructor-inferred` source, and `scope-extractor` breaks a
 * same-strength tie with `>=` — last match wins. So the static field silently
 * RETYPED the instance field of that name and `this.p.hit()` resolved to
 * `Wrong.hit`: not a missing edge but a wrong one, the failure mode
 * `scope-resolution/passes/compound-receiver.ts` exists to avoid. The scope
 * tree has one `typeBindings` map per scope with no static/instance split, so a
 * static field cannot be recorded separately — it is dropped instead.
 *
 * WHAT THAT COSTS, MEASURED rather than assumed (#2807 review, S7). An earlier
 * version of this comment called the cost "a missed edge beats a wrong one".
 * Only half of that is true, and the false half is the one that matters:
 *
 *   shape                       with the drop     without it
 *   --------------------------  ----------------  ----------------
 *   `this.p` (instance twin)    Right  ✓          Wrong  ✗
 *   `Host.p` (static twin)      Right  ✗ WRONG    Wrong  ✓
 *   `Host.q` (static, no twin)  — none, missed    Wrong  ✓
 *
 * For a class declaring BOTH twins the wrong edge does not disappear, it MOVES:
 * `Host.p` now reads the INSTANCE twin's binding, because that is what is left
 * in the map under that name. Only the no-twin case — the common static shape —
 * is a true missed edge.
 *
 * The trade is still the right one, since `this.p` is overwhelmingly the more
 * common access and a `Host.p` static chain is the cheaper place to be wrong.
 * It is recorded here as a wrong edge rather than described as a missing one so
 * that the next person weighing it is weighing the real thing. Closing it
 * properly needs a static/instance split that the shared receiver fold cannot
 * express today — `foldReceiverChain` in
 * `scope-resolution/passes/compound-receiver.ts` explicitly discards whether a
 * chain's base was a class reference or a value — so it is a separate change
 * with a `SCHEMA_BUMP`, not a tweak here. Both shapes are pinned by rows in
 * `test/integration/resolvers/inferred-field-receiver-matrix.test.ts`
 * (`static-read-of-a-same-name-twin-picks-up-the-instance-type`,
 * `static-read-without-a-twin-loses-its-type`), so the cost moves visibly.
 *
 * Sibling of {@link isStaticMethodThis}, which drops the ASSIGNMENT form
 * (`this.x = new Y()` inside a static method). Together they cover both ways a
 * static member can reach the field-typing path. This is an emit-side filter
 * for the same reason that one is: `static` is an ANONYMOUS token on the
 * declaration node, and a tree-sitter pattern cannot negate one.
 *
 * Detection is the shared `hasKeyword` — matching on child TEXT, never
 * `child.type === 'static'`, because the token reaches the tree as an anonymous
 * token in some grammar versions and a keyword node in others (see
 * `isStaticMember` in `receiver-binding.ts`); a node-type test silently stops
 * firing on a grammar bump and every static field starts retyping its instance
 * twin again. Verified against both grammars in use here: `static` is an
 * anonymous direct child of the caller's field-definition node —
 * `public_field_definition` in TypeScript, `field_definition` in JavaScript —
 * ahead of the name. Each language passes its OWN node-type set rather than the
 * predicate holding both: a literal is only valid in the grammar of the file it
 * appears in, and `grammar-literal-validation` fails a dead one.
 *
 * One deliberate over-fire: `hasKeyword` skips the node's `name` FIELD, and the
 * JavaScript grammar names a field's name `property:`, not `name:` — so the
 * legal-but-rare JavaScript field literally called `static`
 * (`class C { static = new Right(); }`) reads as static and goes untyped. That
 * is a declined binding, the safe direction of the same trade.
 */
export declare function isStaticClassFieldBinding(anchorNode: SyntaxNode | undefined, fieldDefinitionTypes: ReadonlySet<string>): boolean;
export declare function emitTsScopeCaptures(sourceText: string, filePath: string, cachedTree?: unknown): readonly CaptureMatch[];
