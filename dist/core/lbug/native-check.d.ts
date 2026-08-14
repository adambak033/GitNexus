/**
 * Why the native check failed. A failed check is NOT necessarily a missing
 * binary — the package may be absent, the binary may be absent, a binary that is
 * right there may fail to load (host glibc too old, truncated download), or the
 * prebuilt may be present and merely unwritable into place.
 * Callers that render a status line must tell those apart: reporting all of them
 * as "missing" sends users to reinstall a file they already have (#2672).
 */
export type NativeCheckFailureKind = 'package_missing' | 'binary_missing' | 'binary_unwritable' | 'load_failed';
export interface NativeCheckResult {
    ok: boolean;
    binaryPath?: string;
    message?: string;
    /** Set only when `ok` is false. */
    kind?: NativeCheckFailureKind;
}
export declare function checkLbugNative(overridePkgDir?: string): NativeCheckResult;
/**
 * Explain a glibc-too-old native load failure, or null when the probe's stderr
 * describes something else.
 *
 * Reinstalling cannot fix this class — the package ships one prebuilt binary per
 * platform — so the caller must NOT fall through to the reinstall instructions
 * (#2672). Exported for direct unit testing: a real `GLIBC_2.34' not found`
 * cannot be provoked on a host whose glibc is new enough to run the tests.
 */
export declare function glibcTooOldMessage(stderr: string): string | null;
export interface FtsProbeResult {
    loaded: boolean;
    /** Collapsed LadybugDB error when `loaded` is false. */
    reason?: string;
}
/** Same shape for every optional extension; `FtsProbeResult` is the legacy name. */
export type ExtensionProbeResult = FtsProbeResult;
/**
 * Live-probe `LOAD EXTENSION fts` on a throwaway in-memory database.
 *
 * `doctor` used to print the static platform capability, which contradicted
 * analyze whenever the extension file was missing or unloadable (#2374).
 * LOAD never touches the network, so the probe is safe offline, and it
 * surfaces LadybugDB's real error — which distinguishes a missing extension
 * file from a present-but-broken one (wrong platform, truncated download).
 * Dynamic import so doctor still runs when the native module itself is broken.
 *
 * Bounded by `timeoutMs`: an unresponsive extension file (e.g. on a hung
 * network home dir) must never freeze `doctor` — the tool the degradation
 * warnings send users to. `Promise.race` lets doctor report and move on; it
 * cannot cancel an in-flight native call, so a future thread-blocking case
 * would need an out-of-process probe.
 */
export declare function probeFtsExtensionLoad(timeoutMs?: number): Promise<FtsProbeResult>;
/**
 * Live-probe `LOAD EXTENSION vector`, the VECTOR counterpart of the FTS probe.
 *
 * Needed for the same reason #2374 needed the FTS one, and reported the same
 * way: #2623's reporter saw `doctor` print `VECTOR index: available` while
 * every incremental `analyze` was dying because the extension had not loaded.
 * `doctor` derived that line from a static platform capability, so it read
 * "available" no matter what the extension file was doing.
 *
 * Probes for real on every platform, Windows included: the extension server
 * ships win_amd64 VECTOR artifacts for every 0.18.x extension version (the
 * old blanket Windows refusal was stale, #1365-era). LOAD never touches the
 * network and never invokes the installer, so this probe is exactly as safe
 * as the FTS one above.
 */
export declare function probeVectorExtensionLoad(timeoutMs?: number): Promise<ExtensionProbeResult>;
