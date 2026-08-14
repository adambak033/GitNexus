import type { SupertypeShapeDescriptor } from '../../heritage-types.js';
/**
 * Java supertype shapes.
 *
 * A Java extends/implements position (`superclass`, `super_interfaces →
 * type_list`, and `interface_declaration → extends_interfaces → type_list`)
 * can hold a bare `type_identifier`, a `generic_type` (`Foo<T>`), or a
 * `scoped_type_identifier` (`pkg.Foo`). The grammar's `_type` is a hidden
 * supertype, so the concrete shapes are enumerated rather than matching `_type`.
 */
export declare const javaHeritageShapes: SupertypeShapeDescriptor;
