/**
 * Remove Command (#664)
 *
 * Delete the `.gitnexus/` index directory for a registered repo (including
 * both metadata filenames — gitnexus.json and its legacy meta.json mirror —
 * which live inside it) and unregister it from the global registry
 * (~/.gitnexus/registry.json).
 *
 * The target is identified by alias / basename-derived name / remote-inferred name /
 * absolute path — no `--repo` flag, just a positional argument so the
 * destructive-command ergonomics match `clean` (which is also
 * destructive but scoped to `process.cwd()`).
 *
 * Compared to `clean`:
 *   - `clean`  acts on the repo discovered by walking up from cwd.
 *   - `remove` acts on any registered repo identified by name or path.
 *
 * Behaviour notes:
 *   - Idempotent on unknown targets: exits 0 with a warning so that
 *     `remove X && analyze Y` keeps working in scripts. Per #664:
 *     "behave atomically and idempotently so retries are safe".
 *   - Atomic order mirrors `clean`: fs.rm FIRST, then unregister. A
 *     partial failure leaves the registry pointing at a missing dir
 *     (recoverable by `listRegisteredRepos({ validate: true })` on
 *     next read) rather than the opposite, which would orphan
 *     .gitnexus/ directories on disk.
 *   - `-f` / `--force` matches the confirmation-skip semantics of
 *     `clean -f`. (Distinct from `analyze --force`, which re-indexes;
 *     here there is no pipeline, so no conflation.)
 */
export declare const removeCommand: (target: string, options?: {
    force?: boolean;
}) => Promise<void>;
