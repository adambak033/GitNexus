/**
 * Embedding Pipeline Types
 *
 * Type definitions for the embedding generation and semantic search system.
 */
export const LABEL_FUNCTION = 'Function';
export const LABEL_METHOD = 'Method';
export const LABEL_CONSTRUCTOR = 'Constructor';
export const LABEL_CLASS = 'Class';
export const LABEL_INTERFACE = 'Interface';
export const LABEL_STRUCT = 'Struct';
export const LABEL_ENUM = 'Enum';
export const LABEL_TRAIT = 'Trait';
export const LABEL_IMPL = 'Impl';
export const LABEL_MACRO = 'Macro';
export const LABEL_NAMESPACE = 'Namespace';
export const LABEL_TYPE_ALIAS = 'TypeAlias';
export const LABEL_TYPEDEF = 'Typedef';
export const LABEL_CONST = 'Const';
export const LABEL_PROPERTY = 'Property';
export const LABEL_RECORD = 'Record';
export const LABEL_UNION = 'Union';
export const LABEL_STATIC = 'Static';
export const LABEL_VARIABLE = 'Variable';
export const LABEL_CODE_ELEMENT = 'CodeElement';
export const CHUNK_MODE_AST_FUNCTION = 'ast-function';
export const CHUNK_MODE_AST_DECLARATION = 'ast-declaration';
// CHUNK_MODE_CHARACTER exists for type completeness but is a no-op in CHUNKING_RULES —
// omit the entry entirely to get character fallback via chunker.ts dispatch.
export const CHUNK_MODE_CHARACTER = 'character';
export const STRUCTURAL_TEXT_MODE_NONE = 'none';
export const STRUCTURAL_TEXT_MODE_DECLARATION = 'declaration';
/**
 * Node labels that need chunking (have code body, potentially long)
 */
export const CHUNKABLE_LABELS = [
    LABEL_FUNCTION,
    LABEL_METHOD,
    LABEL_CONSTRUCTOR,
    LABEL_CLASS,
    LABEL_INTERFACE,
    LABEL_STRUCT,
    LABEL_ENUM,
    LABEL_TRAIT,
    LABEL_IMPL,
    LABEL_MACRO,
    LABEL_NAMESPACE,
];
/**
 * Node labels that are short (no chunking needed, embed directly)
 */
export const SHORT_LABELS = [
    LABEL_TYPE_ALIAS,
    LABEL_TYPEDEF,
    LABEL_CONST,
    LABEL_PROPERTY,
    LABEL_RECORD,
    LABEL_UNION,
    LABEL_STATIC,
    LABEL_VARIABLE,
];
/**
 * All embeddable labels (union of CHUNKABLE + SHORT)
 */
export const EMBEDDABLE_LABELS = [...CHUNKABLE_LABELS, ...SHORT_LABELS];
/**
 * Check if a label should be embedded
 */
export const isEmbeddableLabel = (label) => EMBEDDABLE_LABELS.includes(label);
/**
 * Check if a label needs chunking
 */
export const isChunkableLabel = (label) => CHUNKABLE_LABELS.includes(label);
/**
 * Check if a label is a short type (no chunking)
 */
export const isShortLabel = (label) => SHORT_LABELS.includes(label);
/**
 * Node labels that have structural names (methods/fields) extractable via AST.
 * Only labels that consume methodNames/fieldNames in their embedding text should
 * be listed here — extra entries trigger wasted AST parses with no effect on output.
 */
export const STRUCTURAL_LABELS = new Set([
    LABEL_CLASS,
    LABEL_STRUCT,
    LABEL_INTERFACE,
]);
/**
 * Node labels that have isExported column in their schema
 */
export const LABELS_WITH_EXPORTED = new Set([
    LABEL_FUNCTION,
    LABEL_CLASS,
    LABEL_INTERFACE,
    LABEL_METHOD,
    LABEL_CODE_ELEMENT,
]);
export const CHUNKING_RULES = {
    [LABEL_FUNCTION]: {
        mode: CHUNK_MODE_AST_FUNCTION,
        includePrefix: true,
        includeSuffix: true,
        groupFields: false,
        structuralTextMode: STRUCTURAL_TEXT_MODE_NONE,
    },
    [LABEL_METHOD]: {
        mode: CHUNK_MODE_AST_FUNCTION,
        includePrefix: true,
        includeSuffix: true,
        groupFields: false,
        structuralTextMode: STRUCTURAL_TEXT_MODE_NONE,
    },
    [LABEL_CONSTRUCTOR]: {
        mode: CHUNK_MODE_AST_FUNCTION,
        includePrefix: true,
        includeSuffix: true,
        groupFields: false,
        structuralTextMode: STRUCTURAL_TEXT_MODE_NONE,
    },
    [LABEL_CLASS]: {
        mode: CHUNK_MODE_AST_DECLARATION,
        includePrefix: true,
        includeSuffix: false,
        groupFields: true,
        structuralTextMode: STRUCTURAL_TEXT_MODE_DECLARATION,
    },
    [LABEL_INTERFACE]: {
        mode: CHUNK_MODE_AST_DECLARATION,
        includePrefix: true,
        includeSuffix: false,
        groupFields: false,
        structuralTextMode: STRUCTURAL_TEXT_MODE_DECLARATION,
    },
    [LABEL_STRUCT]: {
        mode: CHUNK_MODE_AST_DECLARATION,
        includePrefix: true,
        includeSuffix: false,
        groupFields: true,
        structuralTextMode: STRUCTURAL_TEXT_MODE_DECLARATION,
    },
};
/**
 * Default embedding configuration
 * Uses snowflake-arctic-embed-xs for browser efficiency
 * Tries WebGPU first (fast), user can choose WASM fallback if unavailable
 */
export const DEFAULT_EMBEDDING_CONFIG = {
    modelId: 'Snowflake/snowflake-arctic-embed-xs',
    batchSize: 16,
    subBatchSize: 8,
    threads: 2,
    dimensions: 384,
    device: 'auto',
    maxSnippetLength: 500,
    chunkSize: 1200,
    overlap: 120,
    maxDescriptionLength: 150,
};
/**
 * Deduplicate vector search chunk results by nodeId,
 * keeping the chunk with smallest distance for each node.
 */
export const dedupBestChunks = (rows, limit) => {
    const best = new Map();
    for (const row of rows) {
        const existing = best.get(row.nodeId);
        if (!existing || row.distance < existing.distance) {
            best.set(row.nodeId, {
                chunkIndex: row.chunkIndex,
                startLine: row.startLine,
                endLine: row.endLine,
                distance: row.distance,
            });
        }
        if (limit !== undefined && best.size >= limit)
            break;
    }
    return best;
};
const DEFAULT_FETCH_MULTIPLIER = 4;
const DEFAULT_FETCH_BUFFER = 8;
const DEFAULT_MAX_FETCH = 200;
/**
 * Fetch vector-search chunks until we have enough unique nodeIds
 * or can tell the result set is exhausted.
 */
export const collectBestChunks = async (limit, fetchRows, maxFetch = DEFAULT_MAX_FETCH) => {
    if (limit <= 0)
        return new Map();
    let fetchLimit = Math.max(limit * DEFAULT_FETCH_MULTIPLIER, limit + DEFAULT_FETCH_BUFFER);
    let previousFetchLimit = 0;
    while (fetchLimit > previousFetchLimit) {
        const rows = await fetchRows(fetchLimit);
        const bestChunks = dedupBestChunks(rows, limit);
        if (bestChunks.size >= limit || rows.length < fetchLimit) {
            return bestChunks;
        }
        previousFetchLimit = fetchLimit;
        fetchLimit = fetchLimit >= maxFetch ? fetchLimit * 2 : Math.min(maxFetch, fetchLimit * 2);
    }
    return new Map();
};
