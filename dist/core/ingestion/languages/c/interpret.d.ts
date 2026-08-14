import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
/**
 * Interpret a C #include capture into a ParsedImport.
 * C includes are always wildcard imports (all symbols from the header).
 */
export declare function interpretCImport(captures: CaptureMatch): ParsedImport | null;
/**
 * Interpret a C type-binding capture into a ParsedTypeBinding.
 */
export declare function interpretCTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/**
 * Normalize a C type name: strip pointer/array syntax, qualifiers.
 */
export declare function normalizeCTypeName(text: string): string;
