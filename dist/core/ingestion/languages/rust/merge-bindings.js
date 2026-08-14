const TIER = {
    local: 0,
    namespace: 1,
    import: 2,
    reexport: 3,
    wildcard: 4,
};
export function rustMergeBindings(existing, incoming, _scopeId) {
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
