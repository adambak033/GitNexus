// gitnexus/src/core/ingestion/heritage-extractors/configs/javascript.ts
/**
 * JavaScript supertype shapes.
 *
 * `class_heritage` directly holds the parent expression: a bare `identifier`
 * or a `member_expression` (qualified `ns.Base`).
 */
export const javascriptHeritageShapes = {
    shapes: ['identifier', 'member_expression'],
};
