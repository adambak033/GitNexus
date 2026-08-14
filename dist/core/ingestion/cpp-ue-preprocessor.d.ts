/**
 * Strip Unreal Engine reflection macros from C++ source, length-preserving.
 *
 * Returns the original string unchanged if no strong UE marker is detected,
 * so non-UE C++ files (including ones that contain `*_API`-suffixed
 * identifiers like `REST_API` or `HTTP_API`) incur only a single regex test.
 *
 * The `_filePath` parameter is part of the `LanguageProvider.preprocessSource`
 * contract but is unused — UE detection is purely content-based. Accepted and
 * ignored here so the function matches the hook signature exactly.
 */
export declare function stripUeMacros(source: string, _filePath?: string): string;
