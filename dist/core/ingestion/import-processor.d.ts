import { KnowledgeGraph } from '../graph/types.js';
import { ASTCache } from './ast-cache.js';
import type { LanguageProvider } from './language-provider.js';
import type { ExtractedImport } from './workers/parse-worker.js';
import type { ResolutionContext } from './model/resolution-context.js';
import type { ImportResolutionContext } from './import-resolvers/types.js';
import type { SyntaxNode } from './utils/ast-helpers.js';
export type ImportMap = Map<string, Set<string>>;
export type PackageMap = Map<string, Set<string>>;
export declare function buildImportResolutionContext(allPaths: string[]): ImportResolutionContext;
/**
 * Clean and preprocess a raw import source text into a resolved import path.
 * Strips quotes/angle brackets (universal) and applies provider-specific
 * transformations (currently only Kotlin wildcard import detection).
 */
export declare function preprocessImportPath(sourceText: string, importNode: SyntaxNode, provider: LanguageProvider): string | null;
export declare const processImports: (graph: KnowledgeGraph, files: {
    path: string;
    content: string;
}[], astCache: ASTCache, ctx: ResolutionContext, onProgress?: (current: number, total: number) => void, repoRoot?: string, allPaths?: string[]) => Promise<void>;
export declare const processImportsFromExtracted: (graph: KnowledgeGraph, files: {
    path: string;
}[], extractedImports: ExtractedImport[], ctx: ResolutionContext, onProgress?: (current: number, total: number) => void, repoRoot?: string, prebuiltCtx?: ImportResolutionContext) => Promise<void>;
