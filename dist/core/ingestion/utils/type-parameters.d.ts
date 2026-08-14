/**
 * Parse a declared TYPE-PARAMETER LIST out of its own source text.
 *
 * The sibling of `template-arguments.ts`, on the other axis: that file reads the
 * arguments a declaration was written AGAINST (`Vec<bool>` → `['bool']`), this
 * one reads the parameters it was written IN TERMS OF (`template <class T>`,
 * `class Box<T extends Repo>`). See `TypeParameter` in `gitnexus-shared` for why
 * conflating them is a defect rather than a simplification.
 *
 * ── WHY TEXT AND NOT A PER-LANGUAGE JSON PAYLOAD ─────────────────────────────
 *
 * The `@declaration.parameter-types` precedent synthesizes JSON inside each
 * language's `captures.ts`, because a *parameter type* can itself contain a
 * comma (`Dict[str, int]`) and needs a quoting convention. A type-parameter list
 * needs none: every language that has one delimits it with `<…>` and separates
 * entries with commas, and the nesting those commas can hide (`T extends
 * Map<K, V>`) is bracket nesting the same scanner already has to track. So the
 * capture can be the raw list node and the whole parse is shared, which keeps
 * the per-language cost at one query capture instead of a branch in six
 * emitters.
 *
 * ── WHY THIS NAMES NO LANGUAGE (AGENTS.md R6) ────────────────────────────────
 *
 * It recognizes TOKENS, not languages, and every token it recognizes is
 * recognized for all input. `extends` and `:` both introduce a bound wherever
 * they appear; the name is the last identifier ahead of the bound wherever it
 * appears, which is what makes `class T`, `typename T`, `in T`, `out T`,
 * `reified T` and a bare `T` one rule rather than six. No caller passes a
 * language tag and none is inspected — the direct analogue of
 * `extractTemplateArguments`, which has parsed `<…>` for every language from
 * shared code since it was written.
 */
import type { TypeParameter } from '../../../_shared/index.js';
/**
 * The declared type parameters in `text`, in source order, or `undefined` when
 * `text` holds no parseable list.
 *
 * `text` is the raw source of the list node — `<T extends Repo, U>`,
 * `<class T, typename U = int>`, `[T any]` is NOT accepted (see the bracket note
 * below). Leading content before the first `<` is skipped, so a capture that
 * spans `template <class T>` parses identically to one spanning `<class T>`.
 *
 * ANGLE BRACKETS ONLY. Every language this is wired to delimits with `<…>`.
 * Square brackets would be ambiguous against an array/subscript spelling in the
 * same position, and the one language that uses them for this (Go) is served by
 * its own main-thread reader — so accepting `[…]` here would buy nothing and
 * risk reading `int[]` as a parameter list.
 */
export declare function parseTypeParameterList(text: string): TypeParameter[] | undefined;
