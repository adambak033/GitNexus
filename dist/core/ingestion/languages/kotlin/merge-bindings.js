function tierOf(binding) {
    switch (binding.origin) {
        case 'local':
            return 0;
        case 'import':
        case 'namespace':
        case 'reexport':
            return 1;
        case 'wildcard':
            return 2;
        default:
            return 3;
    }
}
export function kotlinMergeBindings(bindings) {
    if (bindings.length === 0)
        return bindings;
    const best = Math.min(...bindings.map(tierOf));
    const seen = new Map();
    for (const binding of bindings) {
        if (tierOf(binding) === best)
            seen.set(binding.def.nodeId, binding);
    }
    return [...seen.values()];
}
