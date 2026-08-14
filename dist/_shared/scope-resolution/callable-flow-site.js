/**
 * Always-on callable-value-flow facts produced during scope extraction.
 *
 * These records deliberately contain no parser nodes or provider-private
 * objects: they cross the worker, disk-cache, and ParsedFile-store boundaries.
 * Language providers recognize syntax and emit `@callable-flow.*` captures;
 * the central extractor attaches lexical scope ids and materializes this
 * language-neutral representation.
 */
export {};
//# sourceMappingURL=callable-flow-site.js.map