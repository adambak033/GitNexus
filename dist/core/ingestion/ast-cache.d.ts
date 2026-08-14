import Parser from 'tree-sitter';
/**
 * Minimal structural shape consumers need when reading Trees back
 * through a phase-dependency boundary. Declared here so phases that
 * receive ASTCache via `getPhaseOutput<...>` don't hand-roll their
 * own inline structural types that silently drift when ASTCache's
 * contract changes.
 *
 * Typed as `unknown` at the Tree boundary because consumers on the
 * other side of the phase-output map don't share tree-sitter's type
 * graph (e.g. COBOL's standalone processor).
 */
export interface ASTCacheReader {
    get(filePath: string): unknown;
    clear(): void;
}
export interface ASTCache extends ASTCacheReader {
    get: (filePath: string) => Parser.Tree | undefined;
    set: (filePath: string, tree: Parser.Tree) => void;
    clear: () => void;
    stats: () => {
        size: number;
        maxSize: number;
    };
}
export declare const createASTCache: (maxSize?: number) => ASTCache;
