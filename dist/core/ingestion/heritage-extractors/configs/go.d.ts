import type { HeritageExtractionConfig, SupertypeShapeDescriptor } from '../../heritage-types.js';
/**
 * Go embed supertype shapes.
 *
 * Struct embedding (anonymous `field_declaration` type) and interface-in-
 * interface embedding (`interface_type → type_elem`) can both name a bare
 * `type_identifier`, a `qualified_type` (`pkg.Base`), or a `generic_type`
 * (`Gen[T]`). Named struct fields also match the field pattern and are
 * filtered out at runtime by {@link goHeritageConfig.shouldSkipExtends}.
 */
export declare const goHeritageShapes: SupertypeShapeDescriptor;
/**
 * Go heritage extraction config.
 *
 * Go struct embedding: the tree-sitter query matches ALL field_declarations
 * with type_identifier, but only anonymous fields (no name) are embedded.
 * Named fields like `Breed string` also match — skip them.
 *
 * The shouldSkipExtends hook checks if the extends node's parent is a
 * field_declaration with a named field child, indicating a regular
 * (non-embedded) field that should not produce a heritage record.
 *
 * It also skips type-set constraint operands. An interface constraint like
 * `interface { int | float64 }` parses as an `interface_type` containing a
 * single `type_elem` whose named children are the union operands (`int`,
 * `float64`), separated by unnamed `|` tokens — each operand reaches its
 * `type_elem` parent directly via `.parent` (no intermediate binary node).
 * These operands are NOT embedded supertypes, so a multi-operand `type_elem`
 * (more than one named child) is skipped.
 *
 * Residual: a single-element `type_elem` (`interface { ~int }` or
 * `interface { SomeConstraint }`) is structurally indistinguishable from a
 * genuine interface embed by element count alone, so it is left to match. This
 * is acceptable — a one-element type-set is rare in real Go and a spurious
 * embed edge to a builtin/constraint name is harmless (it resolves to nothing).
 */
export declare const goHeritageConfig: HeritageExtractionConfig;
