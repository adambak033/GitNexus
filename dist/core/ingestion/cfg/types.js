/**
 * CFG data model — plain, JSON-serializable types (issue #2081, M1).
 *
 * These cross the worker→main boundary and the disk-backed/durable ParsedFile
 * store, so they must contain NO tree-sitter AST references, class instances,
 * or anything that does not survive `JSON.stringify` → `JSON.parse`. Block and
 * edge endpoints are referenced by integer index within a function's CFG.
 *
 * The per-language `CfgVisitor` (built in the parse worker, where the AST
 * lives — see the M1 plan KTD1/KTD7) produces a `FunctionCfg` per function; the
 * array of them is what rides on `ParsedFile.cfgSideChannel`.
 */
export {};
