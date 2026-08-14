/**
 * `RegistryContext` — the injected state required by the scope-aware
 * registry lookups (RFC §4; Ring 2 SHARED #917).
 *
 * Bundles every Ring 2 index + every provider hook the 7-step algorithm
 * might consult. Threaded through `lookupCore` and the three public
 * registries unchanged; construction is the caller's responsibility
 * (typically once per workspace-indexing pass in Ring 2 PKG).
 *
 * The design intent is **pure-logic in `gitnexus-shared`, data + hooks
 * supplied by the caller**. Nothing here loads files, parses AST, or
 * reaches into the CLI package.
 */
// ─── Per-kind default `acceptedKinds` sets ─────────────────────────────────
//
// Exported so the three public registries stay declarative (each one just
// points at the right constant + passes it to `lookupCore`).
export const CLASS_KINDS = Object.freeze([
    'Class',
    'Interface',
    'Enum',
    'Struct',
    'Union',
    'Trait',
    'TypeAlias',
    'Typedef',
    'Record',
    'Delegate',
    'Annotation',
    'Template',
    'Namespace',
]);
export const METHOD_KINDS = Object.freeze([
    'Method',
    'Function',
    'Constructor',
]);
export const FIELD_KINDS = Object.freeze([
    'Variable',
    'Property',
    'Const',
    'Static',
]);
// Macros occupy a namespace disjoint from functions/methods: a `log!`
// invocation must resolve ONLY to a `macro_rules! log` definition, never
// to a same-named `fn log`. `MACRO_KINDS` is therefore a singleton
// (`['Macro']`) and is NOT merged into METHOD_KINDS — keeping the two
// keyspaces separate is what prevents the cross-namespace false-edge.
export const MACRO_KINDS = Object.freeze(['Macro']);
//# sourceMappingURL=context.js.map