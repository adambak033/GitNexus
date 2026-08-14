/**
 * Coarse-grained type classifier for C++ constraint evaluation
 * (`<https://en.cppreference.com/w/cpp/types/is_integral>`,
 *  `<https://en.cppreference.com/w/cpp/types/is_floating_point>`).
 *
 * Maps a normalized type token (as produced by `normalizeCppParamType` /
 * the call-site inference in `captures.ts`) to one of the categories
 * the `<type_traits>` predicate registry uses for SFINAE filtering.
 *
 * `argumentTypes` remain normalized for overload narrowing, while
 * constraint predicates that need cv/ref/pointer shape read the parallel
 * `argumentTypeClasses` sidecar. Unknown shapes must stay unknown rather
 * than being guessed as incompatible.
 */
export type TypeClass = 'integral' | 'floating' | 'bool' | 'char' | 'string' | 'null' | 'void' | 'enum' | 'class' | 'pointer' | 'reference' | 'unknown';
/**
 * Classify a normalized C++ type token. The mapping mirrors the literal-
 * inference table in `captures.ts:inferCppLiteralType` plus the std::
 * normalization in `arity-metadata.ts:normalizeCppParamType`.
 *
 * Caller note: token should be normalized for overload matching. Enum
 * tokens produced by the C++ adapter use the internal `enum:<Name>`
 * prefix so `is_enum_v` does not have to guess that every user token is
 * class-like.
 */
export declare function classifyType(token: string): TypeClass;
