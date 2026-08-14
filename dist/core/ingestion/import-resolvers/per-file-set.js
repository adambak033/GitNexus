export function perFileSet(build) {
    const cache = new WeakMap();
    return (key) => {
        const cached = cache.get(key);
        if (cached !== undefined)
            return cached;
        const built = build(key);
        cache.set(key, built);
        return built;
    };
}
