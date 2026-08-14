import type { GrpcLanguagePlugin } from './types.js';
export type { GrpcDetection, GrpcLanguagePlugin, GrpcRole } from './types.js';
export { PROTO_GRPC_PLUGIN, extractPackageFromTree } from './proto.js';
/**
 * Glob for source files worth scanning for gRPC server/client patterns.
 * Includes `.proto` when the grammar is available.
 */
export declare const GRPC_SCAN_GLOB: string;
/**
 * Whether the tree-sitter proto plugin is available. The orchestrator
 * uses this to decide between the tree-sitter path and the fallback
 * manual parser for `.proto` files.
 */
export declare const hasProtoPlugin: boolean;
/**
 * Return the gRPC plugin registered for the given file's extension,
 * or `undefined` if the extension is not registered.
 */
export declare function getPluginForFile(rel: string): GrpcLanguagePlugin | undefined;
