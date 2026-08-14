/**
 * Rename with retry on transient EBUSY/EPERM/EACCES (observed on Windows
 * when a concurrent reader holds the target file open).
 */
export declare function retryRename(src: string, dst: string, attempts?: number): Promise<void>;
/**
 * Atomically publish `data` to `targetPath` via a private tmp file + rename.
 *
 * The tmp name carries a random suffix, so concurrent publishers to one target
 * never stage through the same path. A FIXED `<target>.tmp` is not
 * multi-process safe even though the rename itself is atomic: writer B's write
 * overwrites writer A's staged bytes and B's rename moves that inode away, so
 * A's own rename fails with `ENOENT` (#2888).
 *
 * `'wx'` (O_EXCL) closes the symlink/pre-create race, and the `0o600` mode
 * closes the permissions exposure CodeQL's `js/insecure-temporary-file` query
 * reads off the `mode` argument (it requires the low 6 bits to be zero; with
 * no mode the file lands at umask, typically group/world readable).
 *
 * A rejection anywhere after the tmp exists removes it before rethrowing: with
 * a random suffix a leaked tmp is no longer self-limiting the way a fixed name
 * was (the next writer simply overwrote it), so a recurring failure would drop
 * one more orphan beside the target every time. A hard kill between the open
 * and the rename still leaves one behind.
 *
 * `attempts` is passed through to {@link retryRename}; pass `1` when the
 * caller discards the failure anyway, so a best-effort write cannot spend the
 * retry backoff (and, under a lock, make everyone else wait for it).
 */
export declare function writeFileAtomic(targetPath: string, data: string, attempts?: number): Promise<void>;
