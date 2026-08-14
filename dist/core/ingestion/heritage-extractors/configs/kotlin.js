// gitnexus/src/core/ingestion/heritage-extractors/configs/kotlin.ts
/**
 * Kotlin delegation-specifier supertype shapes.
 *
 * The supertype node nested under a `delegation_specifier` is a `user_type`
 * (`: Bar`), a `constructor_invocation` (`: Bar()`), or an
 * `explicit_delegation` (`: Bar by baz`). For the delegation form the inner
 * `user_type` (the `Bar`) is the supertype, not the delegate expression — the
 * runtime normalizer descends into it.
 */
export const kotlinHeritageShapes = {
    shapes: ['user_type', 'constructor_invocation', 'explicit_delegation'],
};
