/**
 * Taint-path reason codec (#2083 M3 U4/U6, plan KTD6).
 *
 * THE one shared encoder/decoder for the hop-encoded `reason` carried on
 * persisted `TAINTED` edges: the U4 emit path writes it, the U6 MCP `explain`
 * tool reads it. Two hand-rolled copies of a wire format drift — both sides
 * MUST import from here.
 *
 * ## Wire format (version `1`)
 *
 * ```
 * 1[;<kind>]|<name>:<line>[:<flags>]|<name>:<line>[:<flags>]|…[|~]
 * ```
 *
 * - One-character version prefix (`TAINT_PATH_CODEC_VERSION`), then an
 *   OPTIONAL `;<kind>` header segment, then ordered source→sink hops, each
 *   `variable:line[:flags]`.
 * - `kind` is the finding's sink category (`SinkKind`, e.g.
 *   `command-injection`). It rides the reason because it is the ONLY
 *   persisted channel: the CodeRelation columns are
 *   `type/confidence/reason/step` — `step` is INT32 and the emit-time edge id
 *   (which embeds the kind) is not a stored column. The U6 `explain` tool
 *   reads it for finding classification. Charset `[a-z0-9-]` (printable
 *   ASCII, disjoint from every structural delimiter); `;` itself is printable
 *   ASCII and never appears in hop names (identifier charset) or flags.
 *   U6 deviation note: this header was added by U6 WITHIN version `1` —
 *   U4 and U6 ship in the same release, so no reason string without the
 *   header was ever persisted by a released build; the decoder still accepts
 *   header-less strings (`kind` simply decodes as `undefined`).
 * - `flags` is a lowercase-letter set; only `c` (= the hop passed through an
 *   unmodeled call, KTD5 `viaCall`) is defined today — the rest of the
 *   alphabet is RESERVED, and the decoder accepts unknown flag letters so a
 *   future writer's output stays decodable.
 * - A trailing `|~` segment is the TRUNCATION MARKER: the encoded path is a
 *   source-side PREFIX of the real one (hop cap, byte cap, or an unencodable
 *   hop name). Decoders MUST report it as "path incomplete" — never an error.
 *
 * ## Delimiter / round-trip discipline (KTD6)
 *
 * Every structural character (`|`, `:`, `~`, digits, flag letters) is
 * printable ASCII: `sanitizeUTF8` (csv-generator.ts) strips control
 * characters, lone surrogates, and U+FFFE/FFFF — printable ASCII passes
 * through byte-exact, so the encoding survives `escapeCSVField ∘
 * sanitizeUTF8` and the DB load unchanged (pinned by the round-trip test).
 * None of the delimiters can appear in a JS identifier.
 *
 * Hop names are identifier-charset by U1 construction (the harvest records
 * binding names), but the encoder DEFENDS anyway: a hop whose name falls
 * outside the safe charset (or whose line is not a non-negative integer) is
 * never emitted — encoding stops at the offending hop and sets the truncation
 * marker, preserving the prefix-of-the-true-path invariant rather than
 * corrupting the format. (`#` is in the charset: JS private names are
 * `#field`, and the propagation engine's fallback hop names are `#<idx>`.)
 *
 * The byte cap (`TAINT_REASON_MAX_BYTES`, KTD6's "absolute reason-byte cap")
 * bounds the persisted reason column regardless of hop caps: overflow drops
 * TRAILING hops (keeps the source side) and sets the marker. All structural
 * chars and valid names are single-byte ASCII, so `string.length` IS the
 * byte length.
 */
/** One-character format version prefix. Bump on any wire-format change. */
export declare const TAINT_PATH_CODEC_VERSION = "1";
/**
 * Absolute cap on the encoded reason's byte length (KTD6). 4096 comfortably
 * holds ~100 hops of realistic identifiers — far beyond the default hop cap
 * (32) — while bounding the persisted column even at `maxHops: 0` (unlimited).
 */
export declare const TAINT_REASON_MAX_BYTES = 4096;
/** The truncation-marker segment content (rides as a trailing `|~`). */
export declare const TAINT_PATH_TRUNCATION_MARKER = "~";
/** Encoder input hop — shape-compatible with `TaintHop` (propagate.ts). */
export interface TaintPathHopInput {
    readonly name: string;
    readonly line: number;
    readonly viaCall?: boolean;
}
export interface EncodeTaintPathOptions {
    /**
     * The hop list is already a truncated prefix (e.g. the propagation engine's
     * `hopsTruncated` from its hop cap) — emit the marker even when every hop
     * fits.
     */
    readonly truncated?: boolean;
    /** Byte cap override (tests). Default {@link TAINT_REASON_MAX_BYTES}. */
    readonly maxBytes?: number;
    /**
     * Finding sink category (`SinkKind`) carried in the `;<kind>` header — the
     * only persisted channel for it (see the module doc). A value outside the
     * `[a-z0-9-]` charset is DROPPED (header omitted), never corrupted into the
     * wire string; `SinkKind` is a closed lowercase-hyphen union so this is
     * purely defensive.
     */
    readonly kind?: string;
}
export interface EncodedTaintPath {
    /** The wire string for the TAINTED edge's `reason` column. */
    readonly reason: string;
    /** True when the marker was emitted (caller-flagged, byte cap, or bad hop). */
    readonly truncated: boolean;
}
export interface DecodedTaintHop {
    readonly variable: string;
    readonly line: number;
    /** The hop passed through an unmodeled call (flag `c`, KTD5). */
    readonly viaCall: boolean;
}
export interface DecodedTaintPath {
    readonly ok: true;
    readonly version: string;
    /** Finding sink category from the `;<kind>` header; absent when not encoded. */
    readonly kind?: string;
    /** Ordered source→sink hops (a PREFIX when `truncated`). */
    readonly hops: readonly DecodedTaintHop[];
    /** Path incomplete (trailing `|~`) — informational, NOT an error. */
    readonly truncated: boolean;
}
/** Typed parse failure — the decoder never throws. */
export interface TaintPathDecodeFailure {
    readonly ok: false;
    readonly error: string;
}
export type TaintPathDecodeResult = DecodedTaintPath | TaintPathDecodeFailure;
/**
 * Encode an ordered hop list into the versioned `reason` wire string.
 * Deterministic; never throws. See the module doc for the format and the
 * three truncation triggers (caller flag, unencodable hop, byte cap).
 */
export declare function encodeTaintPath(hops: readonly TaintPathHopInput[], options?: EncodeTaintPathOptions): EncodedTaintPath;
/**
 * Decode a `reason` wire string. Returns a typed failure for anything that is
 * not a well-formed version-`1` path — never throws. A truncated path decodes
 * `ok: true` with `truncated: true` ("path incomplete", per KTD6).
 */
export declare function decodeTaintPath(reason: unknown): TaintPathDecodeResult;
