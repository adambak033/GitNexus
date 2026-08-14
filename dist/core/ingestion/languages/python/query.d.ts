/**
 * Tree-sitter query for Python scope captures (RFC §5.1).
 *
 * Exposes lazy `Parser` and `Query` singletons so callers don't
 * pay tree-sitter init cost per file.
 */
import Parser from 'tree-sitter';
export declare function getPythonParser(): Parser;
export declare function getPythonScopeQuery(): Parser.Query;
