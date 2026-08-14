/**
 * LadybugDB schema constants — single source of truth.
 *
 * NODE_TABLES and REL_TYPES define what the knowledge graph can contain.
 * Both CLI and web must agree on these for data compatibility.
 *
 * Full DDL schemas remain in each package's own schema.ts because
 * the CLI uses native LadybugDB and the web uses WASM.
 */
export declare const NODE_TABLES: readonly ['File', 'Folder', 'Function', 'Class', 'Interface', 'Method', 'CodeElement', 'Community', 'Process', 'Section', 'Struct', 'Enum', 'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl', 'TypeAlias', 'Const', 'Static', 'Variable', 'Property', 'Record', 'Delegate', 'Annotation', 'Constructor', 'Template', 'Module', 'Route', 'Tool', 'BasicBlock'];
export type NodeTableName = (typeof NODE_TABLES)[number];
export declare const REL_TABLE_NAME = "CodeRelation";
export declare const REL_TYPES: readonly ['CONTAINS', 'DEFINES', 'IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS', 'HAS_METHOD', 'HAS_PROPERTY', 'ACCESSES', 'METHOD_OVERRIDES', 'OVERRIDES', 'METHOD_IMPLEMENTS', 'MEMBER_OF', 'STEP_IN_PROCESS', 'HANDLES_ROUTE', 'FETCHES', 'HANDLES_TOOL', 'ENTRY_POINT_OF', 'WRAPS', 'QUERIES', 'INJECTS', 'CONDITIONAL_ON', 'DECLARES', 'ADVISED_BY', 'CFG', 'REACHING_DEF', 'TAINTED', 'SANITIZES', 'TAINT_PATH', 'CDG', 'POST_DOMINATE'];
export type RelType = (typeof REL_TYPES)[number];
export declare const EMBEDDING_TABLE_NAME = "CodeEmbedding";
//# sourceMappingURL=schema-constants.d.ts.map