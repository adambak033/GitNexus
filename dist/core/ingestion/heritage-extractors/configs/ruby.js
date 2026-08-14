// gitnexus/src/core/ingestion/heritage-extractors/configs/ruby.ts
import { SupportedLanguages } from '../../../../_shared/index.js';
/**
 * Ruby `class A < B` superclass shapes, and the class-name shapes for
 * `class Foo::Bar`. Both positions accept a bare `constant` or a
 * `scope_resolution` (`Base::Sup` / `Foo::Bar`); the normalizer reduces the
 * scope_resolution to its trailing constant.
 */
export const rubyHeritageShapes = {
    shapes: ['constant', 'scope_resolution'],
};
/**
 * Maximum parent depth for enclosing class/module walk.
 * Prevents runaway walks on malformed/deeply-nested ASTs.
 */
const MAX_PARENT_DEPTH = 50;
/**
 * Walk up the AST from a call node to find the enclosing class or module name.
 * Ruby include/extend/prepend calls must be inside a class or module body.
 */
function findEnclosingClassName(callNode) {
    let current = callNode.parent;
    let depth = 0;
    while (current && ++depth <= MAX_PARENT_DEPTH) {
        if (current.type === 'class' || current.type === 'module') {
            const nameNode = current.childForFieldName?.('name');
            if (nameNode)
                return nameNode.text;
        }
        current = current.parent;
    }
    return null;
}
/** Ruby heritage call names that express mixin inclusion. */
const RUBY_HERITAGE_CALL_NAMES = new Set(['include', 'extend', 'prepend']);
/**
 * Ruby heritage extraction config.
 *
 * Ruby expresses inheritance in two ways, and only one of them has
 * dedicated tree-sitter heritage captures:
 *
 * 1. Class inheritance (`class A < B`) produces standard
 *    `@heritage.extends` captures and flows through the generic
 *    capture-based `extract` hook (not defined here — the factory
 *    handles it).
 * 2. Mixin calls (`include`/`extend`/`prepend`) have no dedicated
 *    heritage captures; they surface as ordinary call sites. The
 *    `callBasedHeritage` hook below intercepts them before the call
 *    router, absorbing the mixin routing logic that previously lived
 *    in call-routing.ts (routeRubyCall).
 */
export const rubyHeritageConfig = {
    language: SupportedLanguages.Ruby,
    callBasedHeritage: {
        callNames: RUBY_HERITAGE_CALL_NAMES,
        extract(calledName, callNode, _filePath) {
            const enclosingClass = findEnclosingClassName(callNode);
            if (!enclosingClass)
                return [];
            const results = [];
            const argList = callNode.childForFieldName?.('arguments');
            for (const arg of argList?.children ?? []) {
                if (arg.type === 'constant' || arg.type === 'scope_resolution') {
                    results.push({
                        className: enclosingClass,
                        parentName: arg.text,
                        kind: calledName, // 'include' | 'extend' | 'prepend'
                    });
                }
            }
            return results;
        },
    },
};
