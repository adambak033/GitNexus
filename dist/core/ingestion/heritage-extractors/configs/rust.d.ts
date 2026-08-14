import type { SupertypeShapeDescriptor } from '../../heritage-types.js';
/**
 * Rust trait-impl supertype shapes.
 *
 * An `impl_item` trait position can be `type_identifier`, `generic_type`
 * (`Trait<T>`), or `scoped_type_identifier` (`ns::Trait`). The innermost
 * `name` field is the trait name.
 */
export declare const rustHeritageShapes: SupertypeShapeDescriptor;
