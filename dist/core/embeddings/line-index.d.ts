export interface ResolvedLineRange {
    startLine: number;
    endLine: number;
}
export declare const buildLineIndex: (content: string) => Int32Array;
export declare const lineFromOffset: (lineOffsets: Int32Array, charOffset: number) => number;
export declare const resolveChunkLines: (lineOffsets: Int32Array, startOffset: number, endOffset: number, baseStartLine: number) => ResolvedLineRange;
