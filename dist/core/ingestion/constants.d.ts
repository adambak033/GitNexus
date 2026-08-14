/**
 * Default minimum buffer size for tree-sitter parsing (512 KB).
 * tree-sitter requires bufferSize >= file size in bytes.
 */
export declare const TREE_SITTER_BUFFER_SIZE: number;
/**
 * Maximum buffer size cap (32 MB) to prevent OOM on huge files.
 * Also used as the file-size skip threshold — files larger than this are not parsed.
 */
export declare const TREE_SITTER_MAX_BUFFER: number;
/**
 * Compute adaptive buffer size for tree-sitter parsing.
 * Uses 2x UTF-8 byte size, clamped between 512 KB and 32 MB.
 * Keeps tree-sitter's byte-sized buffer above large ASCII and multibyte sources.
 */
export declare const getTreeSitterContentByteLength: (sourceText: string) => number;
export declare const getTreeSitterBufferSize: (sourceText: string) => number;
