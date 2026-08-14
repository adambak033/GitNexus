/**
 * Escalation gate for the incremental DB writeback (#2409).
 *
 * When the effective write set covers most of the repo, per-file surgery is
 * strictly worse than the proven wipe-and-bulk-COPY plan — the same data
 * volume lands either way, but the surgical plan pays per-table deletes plus
 * COPY-into-non-empty tables, and at that size it measured SLOWER than a full
 * DB load. The orchestrator (`run-analyze.ts`) consults this predicate to
 * decide which write plan to run; only the DB write plan changes on
 * escalation — fileHashes/meta bookkeeping is identical.
 *
 * Extracted to a pure module (tri-review 4669518496) so the AND-gate's
 * boundary corners are pinned by unit tests without multi-minute
 * orchestration permutations — an `&&`→`||` mutation here can no longer
 * survive CI.
 */
export declare const INCREMENTAL_MAX_WRITE_FRACTION = 0.5;
export declare const INCREMENTAL_ESCALATION_MIN_FILES = 50;
/**
 * Should the incremental writeback escalate from per-file surgery to a full
 * wipe-and-bulk-COPY write plan?
 *
 * @param deleteCount        Files whose rows will be DETACH-DELETEd
 *                           (effective write set ∪ deleted files, deduped).
 * @param effectiveWriteCount Size of the effective write set (toWrite ∪
 *                           importer-BFS expansion ∪ boundary-crossing files).
 * @param totalFiles         Current repo file count (denominator).
 *
 * POPULATION MISMATCH (tri-review 4669518496, documented not "fixed"): the
 * numerator counts effective-write-set members, which include importer-BFS
 * results read from the PRE-pipeline DB — those can be now-DELETED paths that
 * the CURRENT file list (the denominator) no longer contains. The fraction is
 * therefore not a true subset ratio and can exceed 1 on delete-heavy runs.
 * That errs toward escalation, which is the safe direction (the full write
 * plan is always correct); the valve's log line clamps the DISPLAYED
 * percentage to 100 so operators aren't shown ">100% of the repo".
 */
export declare const shouldEscalateIncrementalWrite: (deleteCount: number, effectiveWriteCount: number, totalFiles: number) => boolean;
