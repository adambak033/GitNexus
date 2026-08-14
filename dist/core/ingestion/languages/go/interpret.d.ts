import type { CaptureMatch, ParsedImport, ParsedTypeBinding } from '../../../../_shared/index.js';
export declare function interpretGoImport(captures: CaptureMatch): ParsedImport | null;
export declare function interpretGoTypeBinding(captures: CaptureMatch): ParsedTypeBinding | null;
/** `map[K]V` → `V`, trimmed. `undefined` when `text` is not a map spelling. */
export declare function goMapValueType(text: string): string | undefined;
export declare function normalizeGoTypeName(text: string): string;
/**
 * Like `normalizeGoTypeName` but preserves dotted package-prefix
 * (`models.User` stays `models.User`). Used for return-type
 * annotations so cross-package type chains can resolve through
 * QualifiedNameIndex (which carries `pkg.Type` entries).
 */
export declare function normalizeGoReturnType(text: string): string;
