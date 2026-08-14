/**
 * Semantic Model — public module surface.
 *
 * Barrel re-export for the `model/` module. Consumers outside `model/`
 * should import from this file rather than reaching into individual
 * registry files.
 *
 * The model is owner-scoped type/method/field knowledge layered above
 * `SymbolTable`. File-indexed and name-keyed callable lookups stay in
 * `SymbolTable` by design.
 */
export { type SemanticModel, type MutableSemanticModel, createSemanticModel, } from './semantic-model.js';
export { type SymbolTableReader, type SymbolTableWriter, createSymbolTable, type AddMetadata, CLASS_TYPES, CLASS_TYPES_TUPLE, type ClassLikeLabel, FREE_CALLABLE_TYPES, FREE_CALLABLE_TUPLE, type FreeCallableLabel, CALL_TARGET_TYPES, } from './symbol-table.js';
export { type TypeRegistry, type MutableTypeRegistry, createTypeRegistry, } from './type-registry.js';
export { type MethodRegistry, type MutableMethodRegistry, createMethodRegistry, } from './method-registry.js';
export { type FieldRegistry, type MutableFieldRegistry, createFieldRegistry, } from './field-registry.js';
export { CALLABLE_ONLY_LABELS, INERT_LABELS, DISPATCH_LABELS, ALL_NODE_LABELS, type LabelBehavior, } from './registration-table.js';
