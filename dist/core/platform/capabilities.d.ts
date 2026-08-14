export type CapabilityStatus = 'available' | 'degraded' | 'unavailable';
export type SemanticSearchMode = 'vector-index' | 'exact-scan' | 'unavailable';
export interface RuntimeFingerprint {
    platform: NodeJS.Platform;
    arch: string;
    node: string;
    gitnexus: string;
    ladybugdb?: string;
    onnxruntime?: string;
}
export interface RuntimeCapabilities {
    graph: CapabilityStatus;
    fts: CapabilityStatus;
    vector: CapabilityStatus;
    semanticMode: SemanticSearchMode;
    exactScanLimit: number;
    reason?: string;
}
export declare const DEFAULT_EXACT_SCAN_LIMIT = 10000;
export declare const getExactScanLimit: () => number;
export declare const getRuntimeFingerprint: () => RuntimeFingerprint;
export declare const getRuntimeCapabilities: () => RuntimeCapabilities;
export declare const defaultEmbeddingThreads: () => number;
