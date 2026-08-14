/**
 * Decompose a PHP `namespace_use_declaration` into one or more
 * `CaptureMatch` objects carrying the synthesized markers
 * `@import.kind` / `@import.source` / `@import.name` / `@import.alias`
 * that `interpretPhpImport` consumes.
 *
 * PHP import forms handled:
 *
 *   use Foo\Bar;                      → namespace, localName=Bar
 *   use Foo\Bar as Baz;               → alias, localName=Baz
 *   use function Foo\bar;             → function, localName=bar
 *   use const Foo\BAR;                → const, localName=BAR
 *   use Foo\{A, B as C};              → grouped: one match per clause
 *   use function Foo\{f, g as h};     → grouped function variants
 *   use const Foo\{X, Y as Z};        → grouped const variants
 *
 * Unlike C#'s decomposer this is 1:N — each grouped use_declaration
 * fans out to one CaptureMatch per inner clause.
 */
import { nodeToCapture, syntheticCapture } from '../../utils/ast-helpers.js';
/**
 * Decompose a `namespace_use_declaration` node into one `CaptureMatch`
 * per logical import. Returns `[]` when the node is unrecognized or
 * carries no resolvable clauses.
 */
export function splitNamespaceUseDeclaration(stmtNode) {
    if (stmtNode.type !== 'namespace_use_declaration')
        return [];
    // Detect qualifier keyword: `use function` / `use const`
    // tree-sitter-php uses a `use_type` or `function`/`const` keyword
    // child to distinguish them. We scan the raw text before the first
    // backslash-path child.
    const qualifier = detectQualifier(stmtNode);
    // Grouped use: `use Foo\{A, B as C}` — find namespace_use_group child.
    const groupNode = findNamedChild(stmtNode, 'namespace_use_group');
    if (groupNode !== null) {
        return decomposeGrouped(stmtNode, groupNode, qualifier);
    }
    // Non-grouped: iterate namespace_use_clause children (one per comma-separated
    // import in `use A, B, C;`). The first import is also a namespace_use_clause
    // in the grammar version used by the monorepo; namespace_name child handling
    // was removed after confirming the clause wrapper covers all positions.
    const out = [];
    for (let i = 0; i < stmtNode.namedChildCount; i++) {
        const child = stmtNode.namedChild(i);
        if (child === null || child.type !== 'namespace_use_clause')
            continue;
        const spec = parseUseClause(child, qualifier);
        if (spec !== null) {
            out.push(buildImportMatch(stmtNode, spec));
        }
    }
    return out;
}
// ── Qualifier detection ────────────────────────────────────────────────────
/**
 * Return the qualifier keyword appearing after `use`:
 * `'function'`, `'const'`, or `null` for plain namespace use.
 *
 * tree-sitter-php emits the qualifier as a `name` node with text
 * "function" or "const" (not a keyword token in recent grammars),
 * or as a dedicated `use_type` node. We inspect the node's raw text
 * to be grammar-version-agnostic.
 */
function detectQualifier(node) {
    const raw = node.text;
    // Match `use function` or `use const` at the start (after optional whitespace)
    if (/^\s*use\s+function\s/i.test(raw))
        return 'function';
    if (/^\s*use\s+const\s/i.test(raw))
        return 'const';
    return 'namespace';
}
function parseUseClause(clause, qualifier) {
    // namespace_use_clause:
    //   qualified_name (or name)
    //   optional: alias_clause → "as" name   (some grammar versions)
    //   optional: bare name node             (tree-sitter-php ≥ 0.22 emits the
    //                                         alias as a sibling `name` node
    //                                         directly, not inside alias_clause)
    const qualName = findNamedChild(clause, 'qualified_name') ?? findNamedChild(clause, 'name');
    if (qualName === null)
        return null;
    const source = qualName.text.trim();
    if (source === '')
        return null;
    // Strategy: bare sibling `name` node after the qualified_name.
    // tree-sitter-php (≥ 0.22) emits `use Foo\Bar as Baz` as:
    //   namespace_use_clause
    //     qualified_name "Foo\Bar"
    //     name "Baz"          ← alias, no alias_clause wrapper
    // Detect by: clause has ≥2 named children AND the last named child is
    // a `name` node that differs from the qualName node.
    if (clause.namedChildCount >= 2) {
        const lastChild = clause.namedChild(clause.namedChildCount - 1);
        if (lastChild !== null && lastChild !== qualName && lastChild.type === 'name') {
            const alias = lastChild.text.trim();
            if (alias !== '') {
                return {
                    kind: 'alias',
                    symbolKind: symbolKindFor(qualifier),
                    source,
                    name: alias,
                    alias,
                    atNode: clause,
                };
            }
        }
    }
    return {
        kind: qualifier,
        symbolKind: symbolKindFor(qualifier),
        source,
        name: lastSegment(source),
        atNode: clause,
    };
}
// ── Grouped use decomposition ──────────────────────────────────────────────
/**
 * Decompose `use Foo\Bar\{A, B as C, function f, const X}` into one
 * `CaptureMatch` per inner clause.
 *
 * The leading prefix (`Foo\Bar`) is prepended to each inner path.
 * Inner clauses can override the qualifier with their own `function` /
 * `const` keyword inside the group.
 */
function decomposeGrouped(stmtNode, groupNode, outerQualifier) {
    // The prefix is the namespace_name that precedes the `{...}` group.
    // tree-sitter-php emits the leading path as a namespace_name child,
    // not qualified_name.
    const prefixNode = findNamedChild(stmtNode, 'namespace_name') ?? findNamedChild(stmtNode, 'name');
    const prefix = prefixNode?.text.trim() ?? '';
    const out = [];
    for (let i = 0; i < groupNode.namedChildCount; i++) {
        const child = groupNode.namedChild(i);
        if (child === null)
            continue;
        // Each child in a group may be:
        //   namespace_use_clause  — plain or aliased
        //   namespace_use_type    — `function` or `const` qualifier inside group
        // We detect an inline qualifier by checking the raw text of the clause.
        if (child.type !== 'namespace_use_clause')
            continue;
        const innerQualifier = detectInnerQualifier(child) ?? outerQualifier;
        const spec = parseInnerClause(child, prefix, innerQualifier);
        if (spec !== null) {
            out.push(buildImportMatch(stmtNode, spec));
        }
    }
    return out;
}
/**
 * Detect an inline qualifier keyword inside a grouped clause.
 * e.g. `use Foo\{function bar, const BAZ}` — each clause may start with
 * `function` or `const`.
 */
function detectInnerQualifier(clause) {
    const raw = clause.text.trim();
    if (/^function\s/i.test(raw))
        return 'function';
    if (/^const\s/i.test(raw))
        return 'const';
    return null;
}
function parseInnerClause(clause, prefix, qualifier) {
    const qualName = findNamedChild(clause, 'qualified_name') ?? findNamedChild(clause, 'name');
    if (qualName === null)
        return null;
    // Strip inline `function` / `const` text prefix if present in the text.
    let innerPath = qualName.text.trim();
    innerPath = innerPath.replace(/^(?:function|const)\s+/i, '').trim();
    if (innerPath === '')
        return null;
    const source = prefix !== '' ? `${prefix}\\${innerPath}` : innerPath;
    // Strategy: bare sibling `name` node after the qualified_name (tree-sitter-php ≥ 0.22).
    if (clause.namedChildCount >= 2) {
        const lastChild = clause.namedChild(clause.namedChildCount - 1);
        if (lastChild !== null && lastChild !== qualName && lastChild.type === 'name') {
            const alias = lastChild.text.trim();
            if (alias !== '') {
                return {
                    kind: 'alias',
                    symbolKind: symbolKindFor(qualifier),
                    source,
                    name: alias,
                    alias,
                    atNode: clause,
                };
            }
        }
    }
    return {
        kind: qualifier,
        symbolKind: symbolKindFor(qualifier),
        source,
        name: lastSegment(innerPath),
        atNode: clause,
    };
}
// ── CaptureMatch builder ───────────────────────────────────────────────────
function buildImportMatch(stmtNode, spec) {
    const m = {
        '@import.statement': nodeToCapture('@import.statement', stmtNode),
        '@import.kind': syntheticCapture('@import.kind', spec.atNode, spec.kind),
        '@import.symbol-kind': syntheticCapture('@import.symbol-kind', spec.atNode, spec.symbolKind),
        '@import.source': syntheticCapture('@import.source', spec.atNode, spec.source),
        '@import.name': syntheticCapture('@import.name', spec.atNode, spec.name),
    };
    if (spec.alias !== undefined) {
        m['@import.alias'] = syntheticCapture('@import.alias', spec.atNode, spec.alias);
    }
    return m;
}
// ── Helpers ────────────────────────────────────────────────────────────────
/** Last backslash-separated segment: `Foo\Bar\Baz` → `Baz`. */
function lastSegment(path) {
    const parts = path.split('\\').filter(Boolean);
    return parts[parts.length - 1] ?? path;
}
function symbolKindFor(kind) {
    if (kind === 'function')
        return 'function';
    if (kind === 'const')
        return 'const';
    return 'type';
}
/** Find the first named child with a given node type. */
function findNamedChild(node, type) {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child !== null && child.type === type)
            return child;
    }
    return null;
}
