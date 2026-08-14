/**
 * Receiver-chain codec.
 *
 * THE one encoder/decoder for the compact receiver chain carried on
 * `ReferenceSite.receiverChain`: the capture emitters write it, the
 * scope-resolution fold reads it, and the durable ParsedFile store validates
 * it. Two hand-rolled copies of a wire format drift — every side MUST import
 * from here. (`taint/path-codec.ts` is the in-repo precedent for both the
 * discipline and the shape.)
 *
 * ## Why a string rather than `MixedChainStep[]`
 *
 * `makeInterningReviver` (parsedfile-store.ts) interns strings, but it
 * re-shares OBJECTS only when they carry `nodeId` + `filePath`. A
 * `MixedChainStep` has neither, so an object encoding leaves every step object
 * and every chain array as a distinct allocation on every warm load, while a
 * string collapses to one interned instance per distinct chain.
 *
 * ## Wire format (version `2`)
 *
 * ```
 * 2|<base>|<step>|<step>…[|~]
 * ```
 *
 * - One-character version prefix, then the BASE receiver name, then ordered
 *   base-first steps.
 * - Each step is a one-character kind sigil followed by the member name:
 *   `c` = call (`getUser()`), `f` = field (`address`). The sigil is the first
 *   character of the segment and the name follows immediately, so a member
 *   whose name begins with `c` or `f` needs no escaping (`ccount` decodes as a
 *   call to `count`).
 * - `a` = await and `i` = index are NAME-FREE and encode as a BARE sigil: an
 *   awaited call's name already lives on its `c` step, and a subscript's key is
 *   a value rather than an identifier the resolver could look up. The decoder
 *   rejects any trailing characters after `a` or `i`, which is what keeps an
 *   accidentally empty-name `c` or `f` segment refusing instead of decoding as
 *   one of these.
 * - A trailing `|~` segment is the TRUNCATION MARKER. NOTE: no current producer
 *   mints one. `extractMixedChain` signals "stopped early" by returning
 *   `baseReceiverName: undefined`, and the encoder requires a base, so a
 *   truncated chain is unrepresentable rather than merely unused. The marker and
 *   the decoder/fold guards are kept as a forward-compatible contract: a future
 *   producer that CAN report a partial chain must set it, and the fold already
 *   refuses such chains. Read the `truncated` field as "reserved", not "live". the chain hit
 *   `MAX_CHAIN_DEPTH` and what is encoded is a base-side PREFIX of the real
 *   chain. A consumer MUST treat a truncated chain as unusable for typing —
 *   the missing tail is exactly what determines the final type — but never as
 *   an error.
 *
 * `|` and `~` cannot appear in an identifier in any supported language, so the
 * format needs no escaping and a malformed payload cannot silently decode as a
 * different valid chain.
 *
 * For `svc.getUser().address.save()`, the receiver of `save` encodes as
 * `2|svc|cgetUser|faddress` — 23 bytes. For `(await svc.getUserAsync()).save()`
 * it is `2|svc|cgetUserAsync|a`.
 */
import type { MixedChainStep } from '../../../_shared/index.js';
/** Hard cap on the encoded payload. `MAX_CHAIN_DEPTH` already bounds the step
 *  COUNT; this bounds the total bytes so a pathological identifier cannot grow
 *  a shard without limit. Generous against real identifiers — the encoding for
 *  a full-depth chain of 30-character names is still under 130 bytes. */
export declare const MAX_RECEIVER_CHAIN_BYTES = 512;
export interface DecodedReceiverChain {
    readonly baseReceiverName: string;
    readonly steps: readonly MixedChainStep[];
    /** The encoded chain is a base-side prefix — the real chain was longer.
     *  Typing off a truncated chain would type off the wrong member. */
    readonly truncated: boolean;
}
/**
 * Encode a chain, or `undefined` when it cannot be represented — an empty
 * chain (nothing to fold), an unencodable name, or a payload over the byte
 * cap. Refusing to mint is deliberate: a half-encoded chain would be decoded
 * as a complete-but-different one.
 */
export declare function encodeReceiverChain(baseReceiverName: string, steps: readonly MixedChainStep[], options?: {
    readonly truncated?: boolean;
}): string | undefined;
/**
 * Decode a payload, or `undefined` when it is not a well-formed chain. Total
 * function: every malformed input returns `undefined` rather than throwing,
 * because the two callers that matter — the extractor and the untrusted store
 * boundary — are both on paths where a throw would cost the whole file.
 */
export declare function decodeReceiverChain(value: unknown): DecodedReceiverChain | undefined;
/** Whether a persisted value is a chain this build can use. The store boundary
 *  wants the predicate, not the decoded value. */
export declare function isValidReceiverChain(value: unknown): value is string;
