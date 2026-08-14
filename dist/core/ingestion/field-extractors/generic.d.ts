/**
 * Generic table-driven field extractor factory.
 *
 * Instead of 14 separate 300-line files, define a config per language and
 * generate extractors from configs.  The factory creates a class extending
 * BaseFieldExtractor whose behaviour is entirely driven by FieldExtractionConfig.
 */
import type { SyntaxNode } from '../utils/ast-helpers.js';
import { SupportedLanguages } from '../../../_shared/index.js';
import type { FieldExtractor } from '../field-extractor.js';
import type { FieldExtractorContext, FieldInfo, FieldVisibility } from '../field-types.js';
export interface FieldExtractionConfig {
    language: SupportedLanguages;
    /** AST node types that are class/struct/interface declarations */
    typeDeclarationNodes: string[];
    /** AST node types that represent field/property declarations inside a body */
    fieldNodeTypes: string[];
    /** AST node type(s) for the class body container (e.g., 'class_body', 'declaration_list') */
    bodyNodeTypes: string[];
    /** Default visibility when no modifier is present */
    defaultVisibility: FieldVisibility;
    /** Extract owner type name from a type declaration node. */
    extractOwnerName?: (node: SyntaxNode) => string | undefined;
    /** Find body nodes inside a type declaration node. */
    findBodyNodes?: (node: SyntaxNode) => SyntaxNode[];
    /**
     * Extract field name from a field declaration node.
     * Use this for nodes that declare exactly one field.
     */
    extractName: (node: SyntaxNode) => string | undefined;
    /**
     * Extract multiple field names from a single declaration node.
     * Optional override for languages where one AST node can declare
     * several fields (e.g. Ruby `attr_accessor :foo, :bar`).
     * When present, the factory uses this instead of `extractName`.
     */
    extractNames?: (node: SyntaxNode) => string[];
    /** Extract type annotation from a field declaration node */
    extractType: (node: SyntaxNode) => string | undefined;
    /**
     * Extract the verbatim declared-type source text (trimmed) from a field
     * declaration node, preserving generic arguments (`List<Shape>` stays
     * `List<Shape>`). Unlike `extractType`, the result bypasses
     * `normalizeType`/`resolveType` entirely — it is the untouched source text.
     */
    extractRawType?: (node: SyntaxNode) => string | undefined;
    /**
     * Extract `'@Name'`-prefixed annotation names from a field declaration
     * node (e.g. `['@Autowired']`). Optional — only languages with
     * field-level annotations implement it.
     */
    extractAnnotations?: (node: SyntaxNode) => string[];
    /** Extract visibility from a field declaration node */
    extractVisibility: (node: SyntaxNode) => FieldVisibility;
    /** Extract visibility for one field name from a multi-name declaration. */
    extractVisibilityForName?: (node: SyntaxNode, name: string) => FieldVisibility;
    /** Check if a field is static */
    isStatic: (node: SyntaxNode) => boolean;
    /** Check if a field is readonly/final/const */
    isReadonly: (node: SyntaxNode) => boolean;
    /** Extract fields from primary constructor parameters on the owner node itself
     *  (e.g. C# record positional parameters, C# 12 class primary constructors). */
    extractPrimaryFields?: (ownerNode: SyntaxNode, context: FieldExtractorContext) => FieldInfo[];
}
/**
 * Create a FieldExtractor from a declarative config.
 */
export declare function createFieldExtractor(config: FieldExtractionConfig): FieldExtractor;
