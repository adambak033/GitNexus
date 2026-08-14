import type { SupertypeShapeDescriptor } from '../../heritage-types.js';
/**
 * Python superclass shapes.
 *
 * `class_definition → superclasses (argument_list)` entries can be a bare
 * `identifier`, an `attribute` (qualified `models.Model` — take `.attribute`),
 * or a `subscript` (`Generic[T]` — take `.value`).
 */
export declare const pythonHeritageShapes: SupertypeShapeDescriptor;
