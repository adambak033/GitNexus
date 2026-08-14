export interface DefinitionIdPosition {
    readonly line: number;
    readonly column: number;
}
/**
 * Extract coordinates from `def:<filePath>#<line>:<column>:<type>:<name>`.
 *
 * File paths are embedded verbatim and may themselves contain fragments such
 * as `#12:34:`, while names may themselves contain `#` (TypeScript private
 * members). Anchor on the known file path so neither side can be mistaken for
 * the declaration separator.
 */
export declare function definitionIdPosition(nodeId: string | undefined, filePath: string): DefinitionIdPosition | undefined;
