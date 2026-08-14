// gitnexus/src/core/ingestion/heritage-extractors/configs/rust.ts
/**
 * Rust trait-impl supertype shapes.
 *
 * An `impl_item` trait position can be `type_identifier`, `generic_type`
 * (`Trait<T>`), or `scoped_type_identifier` (`ns::Trait`). The innermost
 * `name` field is the trait name.
 */
export const rustHeritageShapes = {
    shapes: ['type_identifier', 'generic_type', 'scoped_type_identifier'],
};
