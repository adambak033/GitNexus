import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretKotlinImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretKotlinTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
export declare function normalizeKotlinType(text: string): string;
