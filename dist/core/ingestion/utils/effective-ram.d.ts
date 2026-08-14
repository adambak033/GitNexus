/**
 * Effective RAM in bytes: physical total, or a REAL smaller cgroup limit
 * (#2649). `process.constrainedMemory()` returns a huge sentinel when
 * unconstrained, and only the leaf cgroup's limit is visible (parent-slice
 * caps are not) — so a smaller-than-physical value is trusted and anything
 * else falls back to `os.totalmem()`. Mirrors `computeHeapCapMb`'s
 * constrained handling in `cli/analyze.ts`; container-blind sizing told
 * users "this machine has more memory" inside an 8GB-limited container on
 * a 64GB host, and sized worker heap caps past the whole container.
 */
export declare function effectiveRamBytes(): number;
/**
 * The RAM-aware heap cap formula (#2649), single-sourced here so the CLI
 * respawn (`computeHeapCapMb` in `cli/analyze.ts`), and the server's
 * analyze fork size from the same rule: `0.75 × effective RAM`, raised to
 * the floor when RAM allows, never above `0.80 × effective RAM`.
 */
export declare function heapCapMbFor(effectiveBytes: number): number;
/**
 * True when the operator has turned GitNexus's memory autopilot off
 * (`GITNEXUS_MEMORY=off`).
 *
 * One switch for one concern. Memory management has two automatic behaviours —
 * re-running analyze with a RAM-aware heap cap, and aborting the parse before
 * V8's ineffective-mark-compact death spiral — and an operator who wants to
 * drive manually wants both off, not one. They were previously two separate
 * variables (`GITNEXUS_AUTO_HEAP`, `GITNEXUS_HEAP_GUARD`), which is three knobs
 * for one intent once the worker-heap override is counted; neither had shipped,
 * so this consolidates them rather than deprecating anything.
 *
 * Note the ordinary way to pin the heap is Node's own `--max-old-space-size`,
 * which `ensureHeap` already honours as the operator's decision. This switch is
 * for declining the autopilot WITHOUT naming a size.
 *
 * Lives here beside the cap formula so policy and its escape hatch are
 * single-sourced. Read every call (not memoized) so tests can stub the env.
 */
export declare function memoryAutopilotDisabled(): boolean;
/** The cap for THIS machine/container: `heapCapMbFor(effectiveRamBytes())`. */
export declare function autoHeapCapMb(): number;
