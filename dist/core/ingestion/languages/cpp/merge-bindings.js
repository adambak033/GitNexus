const TIER = {
    local: 0,
    namespace: 1,
    import: 2,
    reexport: 3,
    wildcard: 4,
};
/**
 * C++ merge bindings: first-wins by tier.
 *
 * C++ tier precedence:
 *   local(0) > namespace(1) > import(2) > reexport(3) > wildcard(4)
 *
 * Unlike C (no namespaces), C++ uses the `namespace` tier for symbols
 * brought in via `using namespace X;` that are then locally referenced.
 * The tier ordering ensures local definitions shadow namespace imports,
 * which in turn shadow wildcard #include imports.
 */
export function cppMergeBindings(existing, incoming, _scopeId) {
    const seen = new Set();
    return [...existing, ...incoming]
        .sort((a, b) => (TIER[a.origin] ?? 99) - (TIER[b.origin] ?? 99) || a.def.nodeId.localeCompare(b.def.nodeId))
        .filter((binding) => {
        if (seen.has(binding.def.nodeId))
            return false;
        seen.add(binding.def.nodeId);
        return true;
    });
}
