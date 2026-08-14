/**
 * Trivial / no-op-ish hooks for the TypeScript provider. Kept together
 * because each is a few lines and they share a common theme: making
 * the provider's choice explicit rather than relying on "absence ==
 * default" so reviewers don't have to re-derive the analysis.
 */
import type { CaptureMatch, ParsedImport, Scope, ScopeId, ScopeTree, TypeRef } from '../../../../_shared/index.js';
/**
 * TypeScript/JavaScript has block-scoped `let`/`const` (the innermost
 * default covers these) but function-scoped `var` — which hoists to
 * the enclosing **function or module** scope, bypassing intermediate
 * blocks. JS also function-hoists `function_declaration` to the same
 * level.
 *
 * We distinguish var from let/const by sniffing the `@declaration.variable`
 * capture's leading keyword. The capture's text begins with the
 * source-literal keyword (`var ` / `let ` / `const `) because the
 * anchor is the outer `lexical_declaration` / `variable_declaration`
 * node — there's no whitespace before the keyword in any well-formed
 * TS/JS source.
 *
 * Additionally hoists **method return-type bindings**
 * (`@type-binding.return`) all the way to the Module scope, matching
 * C#: the compound-receiver walker and `propagateImportedReturnTypes`
 * both read from module-level typeBindings for cross-file chain
 * propagation.
 */
export declare function tsBindingScopeFor(decl: CaptureMatch, innermost: Scope, tree: ScopeTree): ScopeId | null;
/**
 * TypeScript imports are syntactically top-level: `import_statement` is
 * legal only inside `program` (the module root). `namespace X { … }`
 * bodies CAN contain imports (`internal_module`), in which case the
 * import scopes to the namespace. Dynamic `import()` calls appear
 * inside any scope but their runtime effect is still a module-level
 * resolution — we attach the `ParsedImport` to the innermost Module /
 * Namespace scope so the binding is visible through the full subtree.
 *
 * Returning `null` delegates to the central default, which walks to
 * the nearest enclosing `Module`/`Namespace`. That matches our rule,
 * so we only override when we explicitly need a non-default scope
 * (we don't).
 */
export declare function tsImportOwningScope(_imp: ParsedImport, _innermost: Scope, _tree: ScopeTree): ScopeId | null;
/**
 * Look up `this` on the function scope's type bindings.
 *
 * `this` is synthesized as a type binding on instance-method function
 * scopes during capture emission (`receiver-binding.ts`). Arrow
 * functions and nested functions that reference `this` naturally
 * resolve it via the scope-chain walk — if the arrow function is a
 * class method (`m = () => {}`), it gets a synthesized `this`; if it
 * is nested inside a class method, the scope-chain lookup finds the
 * outer method's `this`. This mirrors TypeScript's lexical-this
 * semantics for arrow functions.
 *
 * Returns `null` for:
 *   - static methods (no `this` synthesized)
 *   - free functions / module-level code (no enclosing class-like)
 *   - non-Function scopes
 *
 * Caveat: a non-arrow `function` declaration nested inside a method
 * DOES see the outer `this` via our scope-chain lookup, even though at
 * runtime its `this` is independently bound (strict-mode `undefined`,
 * sloppy `globalThis`). We accept this false-positive — the real-world
 * pattern that relies on independent `this` inside a nested regular
 * function inside a class method is extremely rare, and catching it
 * would require injecting a `this: undefined` shadow on every non-
 * arrow function scope. Documented as a known limitation in
 * `index.ts`.
 */
export declare function tsReceiverBinding(functionScope: Scope): TypeRef | null;
