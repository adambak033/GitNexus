/**
 * Rank a name→count map highest-first and cap it.
 *
 * `compareCodeUnits`, not `localeCompare` (#2787). The tiebreak feeds the
 * `.slice()` below, so locale-sensitive collation would decide WHICH entries
 * survive the cap, not merely how they are listed — and ICU order varies by
 * platform and ICU build, so two runs over one repo could persist different
 * sets. Key-based lookup is unaffected either way.
 *
 * `omitted` is the number of distinct names past the cap, so the caller can
 * report truncation rather than silently losing entries.
 */
export declare function rankAndCap(counts: ReadonlyMap<string, number>, cap: number): {
    kept: [string, number][];
    omitted: number;
};
/**
 * Read one count out of a persisted map, prototype-safely.
 *
 * The map is revived from JSON, so a bare `counts[name]` returns a Function for
 * `constructor` / `toString` / `valueOf` — all ordinary member and type names in
 * a code graph — and a Function compares as neither absent nor a number, which
 * is how one of these once interpolated a function into user-facing text.
 *
 * Returns `undefined` when the name was never recorded, and only ever a finite
 * positive number otherwise.
 */
export declare function lookupCount(counts: Readonly<Record<string, number>> | undefined, name: string): number | undefined;
