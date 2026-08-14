import Parser from 'tree-sitter';
import { parseSourceSafe } from '../../tree-sitter/safe-parse.js';
/**
 * Compile a LanguagePatterns bundle. Call this once per plugin, at
 * module load time, and export the result. Throws if any pattern
 * fails to compile against the grammar — that's a bug in the plugin
 * author's query, not a runtime condition.
 */
export function compilePatterns(bundle) {
    const compiled = [];
    for (const spec of bundle.patterns) {
        try {
            const query = new Parser.Query(bundle.language, spec.query);
            compiled.push({ query, meta: spec.meta });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`[tree-sitter-scanner] Failed to compile pattern in ${bundle.name}: ${message}\n` +
                `Query source:\n${spec.query}`);
        }
    }
    return { name: bundle.name, language: bundle.language, patterns: compiled };
}
/**
 * Run every compiled pattern in `plugin` against an already-parsed
 * tree. Use this when a plugin needs multiple query bundles against
 * the same file (e.g. one query for class-level prefixes and another
 * for method-level annotations) and wants to avoid re-parsing.
 */
export function runCompiledPatterns(plugin, tree) {
    const out = [];
    for (const compiled of plugin.patterns) {
        let matches;
        try {
            matches = compiled.query.matches(tree.rootNode);
        }
        catch {
            continue;
        }
        for (const match of matches) {
            const captures = {};
            for (const cap of match.captures) {
                if (!(cap.name in captures))
                    captures[cap.name] = cap.node;
            }
            out.push({ meta: compiled.meta, captures });
        }
    }
    return out;
}
/**
 * Parse `content` with the plugin's grammar and run every compiled
 * pattern against the AST. Returns one `ScanMatch` per matched query
 * occurrence, carrying the plugin's meta payload.
 *
 * Errors are swallowed at the file level (malformed file must not abort
 * the whole extract). Individual pattern failures are swallowed too so
 * a single unusable query doesn't block the rest of the plugin.
 */
export function scanFile(parser, plugin, content) {
    let tree;
    try {
        parser.setLanguage(plugin.language);
        tree = parseSourceSafe(parser, content);
    }
    catch {
        return [];
    }
    return runCompiledPatterns(plugin, tree);
}
/**
 * Strip enclosing quotes from a tree-sitter string literal node's text.
 * Handles single / double / template quotes, Python triple-quoted strings,
 * and Go raw string literals (backticks).
 *
 * Returns null for empty/nullish input so callers can uniformly skip
 * captures whose value is missing.
 */
export function unquoteLiteral(raw) {
    if (!raw)
        return null;
    // Python triple-quoted
    if ((raw.startsWith('"""') && raw.endsWith('"""')) ||
        (raw.startsWith("'''") && raw.endsWith("'''"))) {
        return raw.slice(3, -3);
    }
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'" || first === '`') && last === first && raw.length >= 2) {
        return raw.slice(1, -1);
    }
    // Some grammars expose the string content without quotes already (e.g.
    // Python `string_content` child). Return as-is.
    return raw;
}
