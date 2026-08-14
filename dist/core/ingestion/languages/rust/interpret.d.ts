import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretRustImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretRustTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
export declare function normalizeRustTypeName(text: string): string;
