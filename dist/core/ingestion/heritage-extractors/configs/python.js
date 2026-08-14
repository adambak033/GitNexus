// gitnexus/src/core/ingestion/heritage-extractors/configs/python.ts
/**
 * Python superclass shapes.
 *
 * `class_definition → superclasses (argument_list)` entries can be a bare
 * `identifier`, an `attribute` (qualified `models.Model` — take `.attribute`),
 * or a `subscript` (`Generic[T]` — take `.value`).
 */
export const pythonHeritageShapes = {
    shapes: ['identifier', 'attribute', 'subscript'],
};
