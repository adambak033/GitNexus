import type { TypeRef } from '../../../_shared/index.js';
/**
 * Parse top-level generic/template arguments from a type-like string.
 *
 * Examples:
 * - `List<int>` -> ['int']
 * - `Map<string, vector<int>>` -> ['string', 'vector<int>']
 * - `List<T*>` -> ['T*']
 */
export declare function extractTemplateArguments(text: string): string[] | undefined;
/**
 * The type ARGUMENTS a reference applies to its base, read from the reference's
 * own source spelling: `IValidator<string>` → `['string']`, `Base[User]` →
 * `['User']`, `Repository` → `undefined`.
 *
 * The inverse direction of {@link erasedTypeApplication}, which rebuilds the
 * `Base<Args>` SPELLING so a lookup can stay grounded; this returns the
 * ARGUMENTS so a consumer that has already resolved the base can ask which
 * instantiation it was (#2912).
 *
 * Both bracket families count, because both spell type application in a
 * heritage position — `class C : IValidator<string>` and Go's `struct { Base[int] }`
 * / Python's `class C(Base[User])`. What is NOT accepted is anything that fails
 * to be exactly one balanced, non-empty list closing at the very end:
 *
 *   - `Base(args)`      — a C# primary-constructor base, not an application.
 *   - `Foo[]`           — an empty list is an array spelling, not arguments.
 *   - `(Int) -> Unit`   — a Kotlin function type, whose `>` closes nothing.
 *
 * Declining is the safe outcome for all of them: absence reads as "unknown"
 * and every consumer of this fails open on it.
 */
export declare function typeApplicationArguments(spelling: string): string[] | undefined;
/**
 * Index of the `(` that matches the trailing `)` of `text`, or -1 when the text
 * does not end in a balanced call suffix.
 *
 * Shared for the same reason as {@link balancedTailList}: this scan is fiddly
 * enough that two copies would be free to disagree, and it has two unrelated
 * readers — splitting a receiver chain at its call, and stripping a base's
 * constructor invocation off a heritage spelling.
 */
export declare function matchingOpenParen(text: string): number;
/** Drop a balanced `(...)` that ENDS the text — the argument list of a base's
 *  constructor invocation, as in `record R : Base<int>(x)` or Kotlin
 *  `class C : Bar<Int>()`. Anything else is returned unchanged. */
export declare function stripTrailingCallSuffix(text: string): string;
export declare function stripTemplateArguments(text: string): string;
export declare function templateArgumentsIdTag(templateArguments?: readonly string[]): string;
/**
 * Stable short hash for the opaque `SymbolDefinition.templateConstraints`
 * payload (issue #1579). Two function-template overloads with identical
 * `parameterTypes` but mutually-exclusive SFINAE constraints
 * (`enable_if_t<is_integral_v<T>>` vs `enable_if_t<is_floating_point_v<T>>`)
 * must produce distinct graph node IDs so the constraint-filter step
 * has two candidates to narrow between. Without this they collapse to
 * a single Function node and the SFINAE golden case can only emit one
 * edge regardless of resolver fixes.
 *
 * FNV-1a 32-bit, base36 encoded. Deterministic; non-cryptographic — the
 * tag's job is collision-avoidance among same-name overloads in one
 * file, not security.
 */
export declare function constraintsHash(jsonText: string): string;
/** Build the `~c:<hash>` ID suffix from an opaque constraint payload.
 *  Returns empty string when the payload is absent so callers can
 *  string-concatenate unconditionally. */
export declare function templateConstraintsIdTag(payload: unknown): string;
/**
 * The type APPLICATION a type reference was reduced from — `Mapped[User]`,
 * `Repo<User>` — restored to the `Base<Args>` spelling, or `undefined` when
 * this reference is not that shape.
 *
 * ── WHY A LOOKUP MUST NOT BE HANDED THE REDUCED NAME ─────────────────────────
 *
 * `rawName` is post-normalization (see its docstring on `TypeRef`), and several
 * providers reduce a type application to its BASE NAME at capture time —
 * `Mapped[User]` → `Mapped`, `Repo<User>` → `Repo`. That erasure is what lets
 * one declaration answer for every instantiation of it, and it is also the
 * widest step any lookup in this pipeline takes: reaching a declaration by NAME
 * ALONE binds whatever the workspace happens to declare under that name. A
 * third-party `Mapped[User]` beside an unrelated workspace `class Mapped` is
 * then a confident WRONG edge, which is strictly worse than the missing one it
 * replaced.
 *
 * `resolveClassBindingForName` already owns the rule for this — it admits an
 * erased base name only on grounds that connect the site to the declaration
 * (the scope chain binds the name; the declaration is in the same file; the
 * index proves the name is a template family; the file has no cross-file class
 * channel to be absent from). But that route is entered on the SPELLING: a name
 * carrying its arguments takes it, a name already reduced to its base cannot,
 * because nothing distinguishes it from an ordinary class name. So a provider
 * that reduces at capture time sends its receivers down the ungrounded route by
 * construction, whatever the shared lookup does.
 *
 * Restoring the application from `declaredSpelling` — which keeps the
 * annotation exactly as written whenever normalization changed it — puts those
 * receivers back on the grounded route. Restoring rather than reimplementing
 * the grounding here is deliberate: the rule is one rule, and a second copy of
 * it in this file would be free to drift from the one in `scope/walkers.ts`
 * that every other caller uses. (Its predicate is not exported; the exported
 * entry point is the spelling.)
 *
 * ── WHAT COUNTS AS AN APPLICATION ────────────────────────────────────────────
 *
 * `rawName` must be the base the spelling APPLIES arguments to, and the
 * argument list must be the whole of the rest of the spelling — one list,
 * balanced, non-empty. Everything else is left exactly as it resolves today,
 * because a transform that is not certain is a worse failure than no transform:
 *
 *   - `User[]` — an array whose ELEMENT the capture layer already reduced to
 *     `User`. The position is the element, not an application of `User`, and
 *     the empty list is what says so.
 *   - `User[][]` — likewise, and it closes its first list before the end.
 *   - `std::vector<Item>` reduced to `vector<Item>` — the spelling does not
 *     start with the reduced name, so nothing was erased that this can restore.
 *   - `Repo<User>?`, `Map<String, (Int) -> Unit>` — trailing decoration and an
 *     argument list that does not close where it must. Declining leaves the
 *     pre-existing behaviour, which is what "no transform" has to mean.
 *
 * The rebuilt spelling uses ANGLE brackets because that is the spelling
 * `resolveClassBindingForName`'s contract is written against; the punctuation a
 * language spells type application with is not otherwise meaningful here, and
 * nothing downstream reads this string except that lookup.
 */
export declare function erasedTypeApplication(typeRef: TypeRef): string | undefined;
