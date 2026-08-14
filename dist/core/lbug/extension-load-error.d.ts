export type ExtensionLoadErrorKind = 'missing_file' | 'corrupt_file' | 'missing_dependency' | 'unknown';
export interface ExtensionLoadDiagnosis {
    readonly kind: ExtensionLoadErrorKind;
    /** Actionable, literal-English remedy suited to the class. */
    readonly remedy: string;
}
/**
 * On-disk file corruption / wrong-platform. FORCE INSTALL re-downloads.
 * Kept byte-identical to `FILE_CORRUPTION_SIGNATURES` in
 * scripts/install-duckdb-extension.mjs (that `.mjs` cannot import this `.ts`;
 * the duplication is deliberate — the two serve different call sites). Note
 * `/not a valid/i` already covers Windows error 193 ("is not a valid Win32
 * application"), so a truncated Windows download is caught here, before the
 * missing-dependency branch.
 */
export declare const FILE_CORRUPTION_SIGNATURES: readonly RegExp[];
/**
 * Classify a collapsed LadybugDB LOAD error. Order is most-specific-first and is
 * load-bearing: corrupt-file is tested before missing-dependency so a truncated
 * Windows download (error 193, matched by `/not a valid/i`) routes to
 * FORCE-reinstall rather than to the runtime-install remedy.
 */
export declare function classifyExtensionLoadError(reason: string | undefined | null, label?: string): ExtensionLoadDiagnosis;
/** Well-formedness of the extension binary for the host platform + arch. */
export type ExtensionBinaryState = 'absent' | 'corrupt' | 'valid' | 'indeterminate';
/**
 * Pull the extension file path out of lbug's load error. lbug's wrapper is
 * English regardless of OS language — `Failed to load library: {path} which is
 * needed by extension: {name}` (real lbug), or the quoted `Failed to load
 * library '{path}': {reason}` variant — so the path is recoverable in any locale.
 * Only paths ending in `.lbug_extension` are accepted, so a regex misfire can
 * never point the inspector at an arbitrary file.
 */
export declare function extractExtensionPath(reason: string | undefined | null): string | null;
/**
 * A structural verdict on a binary header. `indeterminate` means the probe could
 * not prove validity OR corruption from what it read (e.g. the PE header sits past
 * the BINARY_HEADER_BYTES window) — the caller defers to the string classifier
 * rather than assert a false verdict.
 */
type HeaderVerdict = 'valid' | 'corrupt' | 'indeterminate';
/**
 * Decide whether a binary header is a well-formed shared library for the given
 * platform + architecture — using only the file's structure, no localized text.
 * Pure and injectable (platform/arch as params) so every format+arch combination
 * is unit-testable regardless of the host it runs on.
 */
export declare function classifyBinaryHeader(buf: Buffer, bytesRead: number, platform: NodeJS.Platform, arch: string): HeaderVerdict;
/**
 * Best-effort language-independent inspection of the extension file. Reads the
 * header and classifies it; never throws — a missing file is `absent`, an
 * unreadable one is `indeterminate`.
 */
export declare function inspectExtensionBinary(extensionPath: string | null | undefined): ExtensionBinaryState;
/**
 * Diagnose a LadybugDB load failure, preferring a LANGUAGE-INDEPENDENT structural
 * check of the extension binary over the localized error text:
 *   - file absent             → missing_file
 *   - present but malformed    → corrupt_file       (bad magic / wrong architecture)
 *   - present and well-formed   → missing_dependency (a valid binary the loader rejected)
 * The path comes from lbug's own English wrapper, so this holds in any OS display
 * language. When the file cannot be located or read, it falls back to the string
 * classifier (which still carries the language-independent hedged fallback). This
 * is the entry point every surface should call.
 */
export declare function diagnoseExtensionLoad(reason: string | undefined | null, label?: string): ExtensionLoadDiagnosis;
export {};
