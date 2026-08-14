import type Parser from 'tree-sitter';
import type { ExtractedRoute } from './laravel.js';
export type DjangoFileReader = (relativePath: string) => string | null;
export declare function extractDjangoRoutes(tree: Parser.Tree, filePath: string, parser: Parser, readFile?: DjangoFileReader | null, _visited?: Set<string>): ExtractedRoute[];
