/**
 * `MacroRegistry` — scope-aware lookup for macro definitions
 * (`macro_rules!` in Rust; `#define` in C/C++) referenced from a macro
 * invocation site.
 *
 * Thin wrapper over `lookupCore`, specialized for the macro namespace:
 *
 *   - `acceptedKinds` = `MACRO_KINDS` (`['Macro']` only). Crucially this
 *     does NOT include `Function`/`Method`, so a `log!(…)` invocation can
 *     never resolve to a same-named free function `fn log` — macros and
 *     functions are disjoint namespaces (the false-`CALLS`-edge class the
 *     #1934 review flagged).
 *   - `useReceiverTypeBinding` is **false** — a macro invocation has no
 *     receiver; resolution is name-through-the-lexical-chain + the global
 *     qualified fallback, exactly like `ClassRegistry`.
 *   - Arity is not applied — macros are variadic by nature.
 */
import { lookupCore } from './lookup-core.js';
import { MACRO_KINDS } from './context.js';
export function buildMacroRegistry(ctx) {
    const params = {
        acceptedKinds: MACRO_KINDS,
        useReceiverTypeBinding: false,
        ownerScopedContributor: null,
    };
    return {
        lookup(name, scope) {
            return lookupCore(name, scope, params, ctx);
        },
    };
}
//# sourceMappingURL=macro-registry.js.map