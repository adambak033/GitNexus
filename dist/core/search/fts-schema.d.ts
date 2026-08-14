export interface FTSIndexDefinition {
    readonly table: string;
    readonly indexName: string;
    readonly properties: readonly string[];
}
export declare const FTS_INDEXES: readonly FTSIndexDefinition[];
