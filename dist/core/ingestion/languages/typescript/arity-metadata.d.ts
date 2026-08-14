/**
 * Extract TypeScript arity metadata from a method-like tree-sitter node —
 * `method_definition`, `method_signature`, `abstract_method_signature`,
 * `function_declaration`, `generator_function_declaration`, or
 * `function_signature` (overload signature).
 *
 * Reuses `typescriptMethodConfig.extractParameters` so scope-extracted defs
 * carry the same arity semantics as the legacy parse-worker path:
 *   - Rest parameters (`...args: T[]`) collapse `parameterCount` to
 *     `undefined`, which `typescriptArityCompatibility` treats as
 *     "max unknown" — the candidate stays eligible at
 *     `argCount >= required` (mirrors Python `*args` / C# `params`).
 *   - Optional (`p?: T`) and defaulted (`p: T = …`) parameters both
 *     contribute to `optionalCount`;
 *     `requiredParameterCount = total − optionalCount`.
 *   - `parameterTypes` collects declared type-annotation text for
 *     overload narrowing; TypeScript supports function overloading
 *     (`function f(x: string); function f(x: number); function f(x) {}`),
 *     so populated types let the registry disambiguate same-arity
 *     siblings by declared types.
 *   - A literal `'params'` marker is appended for variadic methods so
 *     `typescriptArityCompatibility` can detect rest params without
 *     re-reading the AST.
 *
 * ## Generics stripping
 *
 * TypeScript parameter types frequently contain generic instantiations
 * (`User<string>`, `Array<User>`, `Promise<User[]>`). For overload
 * narrowing by declared type, we want the "head" name — `User`,
 * `Array`, `Promise` — so `arity-metadata` applies a light strip to
 * each `parameterTypes[i]`:
 *
 *   - `Foo<Bar>`          → `Foo`
 *   - `Foo<Bar, Baz>`     → `Foo`
 *   - `Foo[]`             → `Foo`
 *   - `Foo<Bar>[]`        → `Foo`
 *   - `Foo<Bar<Baz>>`     → `Foo`   (greedy — strip the outermost once)
 *   - plain `Foo`         → `Foo`
 *
 * We do NOT strip unions / intersections at this layer — those stay
 * intact because the registry's overload narrowing is a string
 * equality check; union types shouldn't match anything and we prefer
 * "unknown" to "accidental match". `undefined` / `null` in unions
 * (TS strict mode) is handled by `interpret.ts`'s `stripNullableUnion`
 * when the name would be consumed as a receiver type — that path is
 * separate from this arity-metadata path.
 *
 * Generic type parameters on the function itself (`function f<T>(x: T)`)
 * do NOT enter here — the method extractor reads the `parameters`
 * field only, which contains value parameters, not type parameters.
 */
import type { SyntaxNode } from '../../utils/ast-helpers.js';
interface TsArityMetadata {
    readonly parameterCount: number | undefined;
    readonly requiredParameterCount: number | undefined;
    readonly parameterTypes: readonly string[] | undefined;
}
export declare function computeTsArityMetadata(fnNode: SyntaxNode): TsArityMetadata;
export {};
