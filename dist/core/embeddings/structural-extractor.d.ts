/**
 * Structural Extractor Module
 *
 * Reuses ingestion pipeline's AST-based MethodExtractor / FieldExtractor
 * to extract method and field names for embedding text generation.
 */
export interface StructuralNames {
    methodNames: string[];
    fieldNames: string[];
}
/**
 * Extract method and field names from a class/struct/interface node
 * using the ingestion pipeline's AST extractors.
 */
export declare const extractStructuralNames: (content: string, filePath: string) => Promise<StructuralNames>;
