import { type EmbeddingRuntimeResolution } from '../core/embeddings/runtime-install.js';
import { type NativeCheckResult } from '../core/lbug/native-check.js';
export declare function displayWidth(value: string): number;
export declare function padDisplayEnd(value: string, columns: number): string;
/**
 * Embedding-runtime support status for the `doctor` Embeddings section.
 * Pure and DI-friendly so it can be unit-tested without running the whole
 * command. Delegates the platform decision to
 * {@link getLocalEmbeddingRuntimeBlocker} so the wording stays in one place.
 *
 * - HTTP mode: always supported (never touches the native runtime).
 * - Local mode on an unsupported platform (macOS Intel, #1515): reports the
 *   blocker as `detail` so the caller can surface the full guidance.
 */
export declare function localEmbeddingDoctorStatus(opts: {
    httpMode: boolean;
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
    /** Injectable for tests; defaults to probing the real install. */
    resolution?: EmbeddingRuntimeResolution | null;
    /** Injectable for tests; defaults to this Node's registerHooks capability. */
    prefixLoadable?: boolean;
}): {
    status: string;
    detail: string | null;
};
/**
 * Page-size lines for the `doctor` Runtime section (#1231). Pure so the
 * warning gate can be unit-tested without running the whole command (the
 * `localEmbeddingDoctorStatus` precedent above) — but takes the probed
 * values as plain params rather than injectable probes, because `undefined`
 * is a *meaningful* pageSize state here (probe unavailable / win32) and
 * would collide with a "not provided → use default" DI convention.
 *
 * Returns 0 lines (page size unknown), 1 line (page size), or 2 lines
 * (page size + non-4K warning when the installed @ladybugdb/core does not
 * detect the OS page size at runtime).
 */
export declare function pageSizeDoctorLines(pageSize: number | undefined, ladybugVersion: string | undefined): string[];
/**
 * The hintless buffer-pool doctor line (#2631) — the pool the next Database
 * open in THIS process would get. Same plain-params testable-helper shape as
 * pageSizeDoctorLines above. `pool` is getEffectiveBufferPoolSize(): `0` is
 * the pass-through sentinel for LadybugDB's native 80%-of-RAM default, never
 * printed as "0 MiB". `envRaw` (the raw GITNEXUS_LBUG_BUFFER_POOL_SIZE value)
 * marks operator-supplied absolute values as "(env override)" — no scaling
 * suffix: the hintless default is deliberately unscaled (#2557), and an env
 * value is absolute, so a "×N" note would misdescribe both.
 */
export declare function poolSizeDoctorLine(pool: number, envRaw: string | undefined): string;
/**
 * The `native` status line. Literal label like the page-size and pool-size lines
 * above (no i18n key).
 *
 * A failed check is not automatically a MISSING binary, and saying so is the
 * same misdiagnosis #2672 fixed one layer down: on a host whose glibc is too
 * old, `lbugjs.node` is present and merely unloadable, so "missing" sent users
 * to reinstall a file that was already there — while the detail written to
 * stderr right below said the opposite. Render what the check actually found.
 */
export declare function nativeStatusLine(check: NativeCheckResult): string;
export declare const doctorCommand: () => Promise<void>;
