/** Plain-data JVM package fact captured from the language's existing AST. */
export type JvmPackageFact = {
    readonly status: 'known';
    readonly packageName: string;
} | {
    readonly status: 'unknown';
};
export declare const UNKNOWN_JVM_PACKAGE_FACT: JvmPackageFact;
export interface JvmPackageSyntaxNode {
    readonly type: string;
    readonly text: string;
    readonly hasError: boolean;
    readonly namedChildren: readonly JvmPackageSyntaxNode[];
}
export interface JvmPackageFactOptions {
    readonly packageNodeType: string;
    readonly packageNameNodeTypes: readonly string[];
}
export interface JvmPackageFactStore {
    clear(): void;
    capture(filePath: string, root: JvmPackageSyntaxNode): void;
    set(filePath: string, fact: JvmPackageFact): void;
    get(filePath: string): JvmPackageFact | undefined;
}
/** Validate a package fact restored from an opaque worker payload. */
export declare function isJvmPackageFact(value: unknown): value is JvmPackageFact;
/**
 * Create one language-local package fact store.
 *
 * Package facts are captured while the language's scope extractor already
 * owns a tree-sitter Tree, then serialized through ParsedFile's side-channel.
 * Resolution hooks consume only this plain data and never parse source again.
 */
export declare function createJvmPackageFactStore(options: JvmPackageFactOptions): JvmPackageFactStore;
export declare function extractJvmPackageFact(root: JvmPackageSyntaxNode, options: JvmPackageFactOptions): JvmPackageFact;
