import type { FieldExtractionConfig } from '../generic.js';
/**
 * Swift field extraction config.
 *
 * Handles property_declaration inside class_body / protocol_body and
 * protocol_property_declaration inside protocol_body (F75 — protocol property
 * requirements like "var title: String { get }").
 *
 * tree-sitter-swift uses property_declaration for stored/computed properties.
 * A protocol property requirement parses to its own node type,
 * protocol_property_declaration, whose name lives in a "name:" pattern field
 * (pattern > value_binding_pattern + simple_identifier(bound_identifier)), its
 * type in a sibling type_annotation, and its "{ get }" / "{ get set }" in a
 * protocol_property_requirements child. Note: Swift reuses the "name:" field
 * across many positions (func name, every parameter label, parameter/return
 * type), so the name is synthesized from the simple_identifier inside the
 * pattern rather than read blindly off "name:".
 */
export declare const swiftConfig: FieldExtractionConfig;
