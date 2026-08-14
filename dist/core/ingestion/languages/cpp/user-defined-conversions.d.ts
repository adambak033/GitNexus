import type { ParsedFile } from '../../../../_shared/index.js';
export declare function clearCppUserDefinedConversions(): void;
export declare function hasCppUserDefinedConversion(argType: string, paramType: string): boolean;
export declare function populateCppUserDefinedConversions(parsed: ParsedFile): void;
export declare function registerCppUserDefinedConversion(argType: string, paramType: string): void;
