/**
 * Capture-match → semantic-shape interpreters for TypeScript.
 *
 * Two pure functions, both consumed by the central scope extractor:
 *
 *   - `interpretTsImport`      → `ParsedImport`
 *   - `interpretTsTypeBinding` → `ParsedTypeBinding`  (wired in Unit 6)
 *
 * The import matches arrive pre-decomposed by `emitTsScopeCaptures`
 * (one imported name per match, with synthesized
 * `@import.kind/source/name/alias/type-only` markers — see
 * `import-decomposer.ts`).
 * The type-binding matches arrive straight from the raw query captures —
 * each `@type-binding.*` anchor carries `@type-binding.name` +
 * `@type-binding.type`.
 */
import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretTsImport(captures: CaptureMatch): ParsedImport | null;
/**
 * Interpret a `@type-binding.*` capture-match into a `ParsedTypeBinding`.
 *
 * TypeScript-specific strips:
 *
 *   - Trailing `?` on optional parameters: `(u?: User)` → `User`
 *   - `Promise<User>` / `Array<User>` / `ReadonlyArray<User>` / `Readonly<User>`
 *     → `User`  (wrappers that are transparent to chain propagation)
 *   - Single-arg `List<User>` / `Iterable<User>` / `Iterator<User>` —
 *     mirrors Python/C#'s generic-collection strip for for-of loops
 *   - Trailing `[]` on array types: `User[]` → `User`
 *   - Nullable unions: `User | null` / `User | undefined` / `null | User`
 *     → `User`
 *   - Dotted qualifiers: `models.User` → `User`  (unless the suffix is
 *     a known collection accessor we'd want to preserve — none apply
 *     to TS today, since TS uses `.values()` / `.keys()` call syntax)
 */
export declare function interpretTsTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/**
 * Would this interpreter reduce `text` to the type it CONTAINS rather than to
 * the type it names? True for the array suffix (`Repo[]`) and for every
 * transparent wrapper on {@link stripGeneric}'s list (`Array<Repo>`,
 * `Promise<Repo>`, `Set<Repo>`, …).
 *
 * Exported for the ONE caller that must decline exactly what this returns true
 * for: the JavaScript provider's JSDoc `@type` FIELD binding (#2833). Element
 * reduction is right where it was built — a chain step, a `for…of` variable, an
 * awaited value — and wrong for a field, whose declared type IS the container:
 * a field annotated `{Repo[]}` reduced to `Repo` makes `this.repos.find(…)`,
 * an Array method call, resolve to a repository class's own `find`. A wrong
 * edge, which #2833 treats as strictly worse than a missing one.
 *
 * A predicate rather than a copied name list on purpose: the list lives in
 * `stripGeneric` and a second copy would drift out of sync silently, exactly
 * the failure mode `python/interpret.ts` records for its own reduction.
 */
export declare function reducesToContainedType(text: string): boolean;
