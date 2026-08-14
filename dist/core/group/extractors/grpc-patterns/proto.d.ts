import type { GrpcLanguagePlugin } from './types.js';
/**
 * The proto plugin, or `null` if tree-sitter-proto is not available.
 * The orchestrator checks this at import time and decides whether to
 * use the tree-sitter path or the fallback manual parser.
 */
export declare const PROTO_GRPC_PLUGIN: GrpcLanguagePlugin | null;
/** The package declaration text from a proto file's tree. */
export declare function extractPackageFromTree(tree: import('tree-sitter').Tree): string;
