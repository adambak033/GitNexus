/**
 * #1994: shared codec for the synthetic `__heritage__:` / `__property__:` import
 * markers used by the Ruby and Dart scope resolvers to carry side-effect facts
 * (mixin includes, attr_accessor properties) through the import channel. Both
 * languages share the exact `':'`-delimited wire format, so a single encode/decode
 * pair removes the per-site hand-rolled string handling that produced the #1981
 * edge-drop. Language-NEUTRAL — keyed only on the literal prefixes; no provider
 * branching belongs here.
 */
export type MarkerKind = 'heritage' | 'property';
export declare const HERITAGE_MARKER_PREFIX: string;
export declare const PROPERTY_MARKER_PREFIX: string;
/**
 * Build a marker string `<prefix><field>:<field>:...`. The `':'` delimiter IS the
 * wire format, so a field that itself contains `':'` is structurally invalid and
 * THROWS — callers must pre-normalize colon-bearing values (e.g. a qualified mixin
 * arg `Outer::Mixin` → `Outer.Mixin`). This makes the #1981 silent edge-drop a
 * loud failure instead.
 */
export declare function encodeMarker(kind: MarkerKind, fields: readonly string[]): string;
/**
 * Parse a marker string back into its kind + positional fields, or `null` if `raw`
 * is not a marker. Mirrors the historical `slice(PREFIX.length).split(':')`.
 */
export declare function decodeMarker(raw: string): {
    kind: MarkerKind;
    fields: string[];
} | null;
/**
 * True if `raw` is a synthetic heritage/property marker — exactly the prior
 * `startsWith('__heritage__:') || startsWith('__property__:')` pair.
 */
export declare function isHeritageMarker(raw: string): boolean;
