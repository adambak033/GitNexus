/**
 * Embedding Pipeline Types
 *
 * Type definitions for the embedding generation and semantic search system.
 */
export declare const LABEL_FUNCTION: "Function";
export declare const LABEL_METHOD: "Method";
export declare const LABEL_CONSTRUCTOR: "Constructor";
export declare const LABEL_CLASS: "Class";
export declare const LABEL_INTERFACE: "Interface";
export declare const LABEL_STRUCT: "Struct";
export declare const LABEL_ENUM: "Enum";
export declare const LABEL_TRAIT: "Trait";
export declare const LABEL_IMPL: "Impl";
export declare const LABEL_MACRO: "Macro";
export declare const LABEL_NAMESPACE: "Namespace";
export declare const LABEL_TYPE_ALIAS: "TypeAlias";
export declare const LABEL_TYPEDEF: "Typedef";
export declare const LABEL_CONST: "Const";
export declare const LABEL_PROPERTY: "Property";
export declare const LABEL_RECORD: "Record";
export declare const LABEL_UNION: "Union";
export declare const LABEL_STATIC: "Static";
export declare const LABEL_VARIABLE: "Variable";
export declare const LABEL_CODE_ELEMENT: "CodeElement";
export declare const CHUNK_MODE_AST_FUNCTION: "ast-function";
export declare const CHUNK_MODE_AST_DECLARATION: "ast-declaration";
export declare const CHUNK_MODE_CHARACTER: "character";
export declare const STRUCTURAL_TEXT_MODE_NONE: "none";
export declare const STRUCTURAL_TEXT_MODE_DECLARATION: "declaration";
export interface ChunkingRule {
    mode: typeof CHUNK_MODE_AST_FUNCTION | typeof CHUNK_MODE_AST_DECLARATION | typeof CHUNK_MODE_CHARACTER;
    includePrefix: boolean;
    includeSuffix: boolean;
    groupFields: boolean;
    structuralTextMode: typeof STRUCTURAL_TEXT_MODE_NONE | typeof STRUCTURAL_TEXT_MODE_DECLARATION;
}
/**
 * Node labels that need chunking (have code body, potentially long)
 */
export declare const CHUNKABLE_LABELS: readonly ["Function", "Method", "Constructor", "Class", "Interface", "Struct", "Enum", "Trait", "Impl", "Macro", "Namespace"];
/**
 * Node labels that are short (no chunking needed, embed directly)
 */
export declare const SHORT_LABELS: readonly ["TypeAlias", "Typedef", "Const", "Property", "Record", "Union", "Static", "Variable"];
/**
 * All embeddable labels (union of CHUNKABLE + SHORT)
 */
export declare const EMBEDDABLE_LABELS: readonly ["Function", "Method", "Constructor", "Class", "Interface", "Struct", "Enum", "Trait", "Impl", "Macro", "Namespace", "TypeAlias", "Typedef", "Const", "Property", "Record", "Union", "Static", "Variable"];
export type EmbeddableLabel = (typeof EMBEDDABLE_LABELS)[number];
/**
 * Check if a label should be embedded
 */
export declare const isEmbeddableLabel: (label: string) => label is EmbeddableLabel;
/**
 * Check if a label needs chunking
 */
export declare const isChunkableLabel: (label: string) => boolean;
/**
 * Check if a label is a short type (no chunking)
 */
export declare const isShortLabel: (label: string) => boolean;
/**
 * Node labels that have structural names (methods/fields) extractable via AST.
 * Only labels that consume methodNames/fieldNames in their embedding text should
 * be listed here — extra entries trigger wasted AST parses with no effect on output.
 */
export declare const STRUCTURAL_LABELS: ReadonlySet<string>;
/**
 * Node labels that have isExported column in their schema
 */
export declare const LABELS_WITH_EXPORTED: ReadonlySet<string>;
/**
 * Labels that need special chunking and/or structural text semantics.
 * Any chunkable label omitted here intentionally falls back to characterChunk
 * plus generateCodeBodyText (for example Enum/Trait/Impl/Macro/Namespace).
 */
type ChunkableLabel = (typeof CHUNKABLE_LABELS)[number];
export declare const CHUNKING_RULES: Readonly<Partial<Record<ChunkableLabel, ChunkingRule>>>;
/**
 * Embedding pipeline phases
 */
export type EmbeddingPhase = 'idle' | 'loading-model' | 'embedding' | 'indexing' | 'ready' | 'error';
/**
 * Progress information for the embedding pipeline
 */
export interface EmbeddingProgress {
    phase: EmbeddingPhase;
    percent: number;
    modelDownloadPercent?: number;
    nodesProcessed?: number;
    totalNodes?: number;
    currentBatch?: number;
    totalBatches?: number;
    error?: string;
}
/**
 * Configuration for the embedding pipeline
 */
export interface EmbeddingConfig {
    /** Model identifier for transformers.js (local) or the HTTP endpoint model name */
    modelId: string;
    /** Number of nodes to embed in each batch */
    batchSize: number;
    /** Number of chunks passed to one local/HTTP embedding call */
    subBatchSize: number;
    /** Maximum ONNX Runtime CPU threads for local inference */
    threads: number;
    /** Embedding vector dimensions */
    dimensions: number;
    /** Device to use for inference: 'auto' tries GPU first (DirectML on Windows, CUDA on Linux), falls back to CPU */
    device: 'auto' | 'dml' | 'cuda' | 'cpu' | 'wasm';
    /** Maximum characters of code snippet to include */
    maxSnippetLength: number;
    /** Maximum code chunk size in characters (for chunking long code) */
    chunkSize: number;
    /** Overlap between chunks in characters */
    overlap: number;
    /** Maximum description length in characters */
    maxDescriptionLength: number;
}
/**
 * Default embedding configuration
 * Uses snowflake-arctic-embed-xs for browser efficiency
 * Tries WebGPU first (fast), user can choose WASM fallback if unavailable
 */
export declare const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig;
/**
 * Result from semantic search
 */
export interface SemanticSearchResult {
    nodeId: string;
    name: string;
    label: string;
    filePath: string;
    distance: number;
    startLine?: number;
    endLine?: number;
}
/**
 * Node data for embedding (minimal structure from LadybugDB query)
 */
export interface EmbeddableNode {
    id: string;
    name: string;
    label: string;
    filePath: string;
    content: string;
    startLine?: number;
    endLine?: number;
    isExported?: boolean;
    description?: string;
    parameterCount?: number;
    returnType?: string;
    repoName?: string;
    serverName?: string;
    methodNames?: string[];
    fieldNames?: string[];
}
/**
 * Cached embedding entry restored from LadybugDB before a graph rebuild
 */
export interface CachedEmbedding {
    nodeId: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    embedding: number[];
    contentHash?: string;
}
/**
 * Model download progress from transformers.js
 */
export interface ModelProgress {
    status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
}
export interface ChunkSearchRow {
    nodeId: string;
    chunkIndex: number;
    startLine: number;
    endLine: number;
    distance: number;
}
export interface BestChunkMatch {
    chunkIndex: number;
    startLine: number;
    endLine: number;
    distance: number;
}
/**
 * Deduplicate vector search chunk results by nodeId,
 * keeping the chunk with smallest distance for each node.
 */
export declare const dedupBestChunks: (rows: ChunkSearchRow[], limit?: number) => Map<string, BestChunkMatch>;
/**
 * Fetch vector-search chunks until we have enough unique nodeIds
 * or can tell the result set is exhausted.
 */
export declare const collectBestChunks: (limit: number, fetchRows: (fetchLimit: number) => Promise<ChunkSearchRow[]>, maxFetch?: number) => Promise<Map<string, BestChunkMatch>>;
export {};
