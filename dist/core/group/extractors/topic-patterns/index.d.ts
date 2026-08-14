import type { CompiledPatterns } from '../tree-sitter-scanner.js';
import type { TopicMeta } from './types.js';
export type { TopicMeta, Broker } from './types.js';
/**
 * Glob pattern for files worth scanning. Kept here so adding a new
 * language to the registry also widens the glob automatically via a
 * single edit.
 */
export declare const TOPIC_SCAN_GLOB = "**/*.{ts,tsx,js,jsx,java,go,py}";
/**
 * Return the compiled provider registered for the given file's
 * extension, or `undefined` if the extension is not registered.
 */
export declare function getProviderForFile(rel: string): CompiledPatterns<TopicMeta> | undefined;
