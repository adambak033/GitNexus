/**
 * Shared Ruby call routing logic.
 *
 * Ruby expresses imports and property definitions as method calls rather
 * than syntax-level constructs. This module provides a routing function
 * used by the CLI call-processor, CLI parse-worker, and the web
 * call-processor so that the classification logic lives in one place.
 *
 * Heritage (mixins: include/extend/prepend) was previously routed here
 * but is now emitted by the scope-resolution pipeline. The router still
 * returns 'skip' for these calls so they don't become spurious call edges.
 *
 * NOTE: This file is intentionally duplicated in gitnexus-web/ because the
 * two packages have separate build targets (Node native vs WASM/browser).
 * Keep both copies in sync until a shared package is introduced.
 */
// ── Pre-allocated singletons for common return values ────────────────────────
const CALL_RESULT = { kind: 'call' };
const SKIP_RESULT = { kind: 'skip' };
// ── Routing function ────────────────────────────────────────────────────────
/**
 * Classify a Ruby call node and extract its semantic payload.
 *
 * @param calledName - The method name (e.g. 'require', 'include', 'attr_accessor')
 * @param callNode   - The tree-sitter `call` AST node
 * @returns A discriminated union describing the call's semantic role
 */
export function routeRubyCall(calledName, callNode) {
    // ── require / require_relative → import ─────────────────────────────────
    if (calledName === 'require' || calledName === 'require_relative') {
        const argList = callNode.childForFieldName?.('arguments');
        const stringNode = argList?.children?.find((c) => c.type === 'string');
        const contentNode = stringNode?.children?.find((c) => c.type === 'string_content');
        if (!contentNode)
            return SKIP_RESULT;
        let importPath = contentNode.text;
        // Validate: reject null bytes, control chars, excessively long paths
        if (!importPath || importPath.length > 1024 || /[\x00-\x1f]/.test(importPath)) {
            return SKIP_RESULT;
        }
        const isRelative = calledName === 'require_relative';
        if (isRelative && !importPath.startsWith('.')) {
            importPath = './' + importPath;
        }
        return { kind: 'import', importPath, isRelative };
    }
    // ── include / extend / prepend — heritage (emitted by scope-resolution) ─
    // Call-based heritage (Ruby mixins) is emitted by the scope-resolution
    // pipeline. Return SKIP_RESULT so these calls don't fall through to normal
    // call processing and become spurious call edges.
    if (calledName === 'include' || calledName === 'extend' || calledName === 'prepend') {
        return SKIP_RESULT;
    }
    // ── attr_accessor / attr_reader / attr_writer → property definitions ───
    if (calledName === 'attr_accessor' ||
        calledName === 'attr_reader' ||
        calledName === 'attr_writer') {
        // Extract YARD @return [Type] from preceding comment (e.g. `# @return [Address]`)
        let yardType;
        let sibling = callNode.previousSibling;
        while (sibling) {
            if (sibling.type === 'comment') {
                const match = /@return\s+\[([^\]]+)\]/.exec(sibling.text);
                if (match) {
                    const raw = match[1].trim();
                    // Extract simple type name: "User", "Array<User>" → "User"
                    const simple = raw.match(/^([A-Z]\w*)/);
                    if (simple)
                        yardType = simple[1];
                    break;
                }
            }
            else if (sibling.isNamed) {
                break; // stop at non-comment named sibling
            }
            sibling = sibling.previousSibling;
        }
        const items = [];
        const argList = callNode.childForFieldName?.('arguments');
        for (const arg of argList?.children ?? []) {
            if (arg.type === 'simple_symbol') {
                items.push({
                    propName: arg.text.startsWith(':') ? arg.text.slice(1) : arg.text,
                    accessorType: calledName,
                    startLine: arg.startPosition.row,
                    endLine: arg.endPosition.row,
                    ...(yardType ? { declaredType: yardType } : {}),
                });
            }
        }
        return items.length > 0 ? { kind: 'properties', items } : SKIP_RESULT;
    }
    // ── Everything else → regular call ─────────────────────────────────────
    return CALL_RESULT;
}
