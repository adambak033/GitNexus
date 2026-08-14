import type { ThriftLanguagePlugin } from './types.js';
export type { ThriftDetection, ThriftLanguagePlugin, ThriftRole } from './types.js';
export declare const THRIFT_SCAN_GLOB = "**/*.java";
export declare function getPluginForFile(rel: string): ThriftLanguagePlugin | undefined;
