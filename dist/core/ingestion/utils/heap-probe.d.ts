/**
 * Synchronous heap probes for large-repo OOM investigation (#1983).
 *
 * Writes to stderr (not pino) so lines flush under CI=1 / gdb attach.
 * Enabled with `GITNEXUS_DEBUG_HEAP=1` or `GITNEXUS_PROFILE_DEFERRED=1`.
 */
export declare const isDebugHeapEnabled: () => boolean;
export declare const heapUsedMb: () => number;
/**
 * Flush a one-line heap snapshot to stderr.
 *
 * stderr is async on a pipe (Linux), so a probe written just before an
 * OOM-kill is lost in the pipe buffer. For OOM investigation set
 * `GITNEXUS_HEAP_PROBE_FILE=/path` — each probe is then ALSO appended to
 * that file with a synchronous `appendFileSync`, whose `write(2)` syscall
 * completes (data handed to the kernel) before the call returns, so the
 * last line survives SIGKILL. Includes rss alongside heapUsed so the
 * native/off-heap gap is visible.
 */
export declare const logHeapProbe: (label: string, detail?: string) => void;
