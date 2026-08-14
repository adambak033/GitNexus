import { LRUCache } from 'lru-cache';
import { logger } from '../logger.js';
export const createASTCache = (maxSize = 50) => {
    const effectiveMax = Math.max(maxSize, 1);
    // Initialize the cache with a 'dispose' handler
    // This is the magic: When an item is evicted (dropped), this runs automatically.
    const cache = new LRUCache({
        max: effectiveMax,
        dispose: (tree) => {
            try {
                // NOTE: web-tree-sitter has tree.delete(); native tree-sitter
                // trees are GC-managed and .delete is absent (no-op here).
                //
                // Single-owner invariant (load-bearing under WASM): a given
                // Parser.Tree reference must live in AT MOST ONE ASTCache
                // that disposes. The parse-phase chunk-local cache clears
                // between chunks; the cross-phase `scopeTreeCache` (also an
                // ASTCache today) holds the same Tree by reference. Under
                // native tree-sitter this is benign (dispose is a no-op).
                // If/when GitNexus adopts web-tree-sitter for sequential
                // parsing, the cross-phase cache must either (a) skip
                // writing Trees that are already owned by a disposing cache,
                // or (b) use tree.copy() per entry. Failing to pick one
                // will hand freed memory to scope-resolution.
                tree.delete?.();
            }
            catch (e) {
                logger.warn({ e }, 'Failed to delete tree from WASM memory');
            }
        },
    });
    return {
        get: (filePath) => {
            const tree = cache.get(filePath);
            return tree; // Returns undefined if not found
        },
        set: (filePath, tree) => {
            cache.set(filePath, tree);
        },
        clear: () => {
            cache.clear();
        },
        stats: () => ({
            size: cache.size,
            maxSize: effectiveMax,
        }),
    };
};
