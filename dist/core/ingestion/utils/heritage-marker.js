const PREFIX_BY_KIND = {
    heritage: '__heritage__:',
    property: '__property__:',
};
export const HERITAGE_MARKER_PREFIX = PREFIX_BY_KIND.heritage;
export const PROPERTY_MARKER_PREFIX = PREFIX_BY_KIND.property;
/**
 * Build a marker string `<prefix><field>:<field>:...`. The `':'` delimiter IS the
 * wire format, so a field that itself contains `':'` is structurally invalid and
 * THROWS — callers must pre-normalize colon-bearing values (e.g. a qualified mixin
 * arg `Outer::Mixin` → `Outer.Mixin`). This makes the #1981 silent edge-drop a
 * loud failure instead.
 */
export function encodeMarker(kind, fields) {
    for (const field of fields) {
        if (field.includes(':')) {
            throw new Error(`encodeMarker: field "${field}" contains the ':' delimiter; normalize it before encoding`);
        }
    }
    return PREFIX_BY_KIND[kind] + fields.join(':');
}
/**
 * Parse a marker string back into its kind + positional fields, or `null` if `raw`
 * is not a marker. Mirrors the historical `slice(PREFIX.length).split(':')`.
 */
export function decodeMarker(raw) {
    if (raw.startsWith(PREFIX_BY_KIND.heritage)) {
        return { kind: 'heritage', fields: raw.slice(PREFIX_BY_KIND.heritage.length).split(':') };
    }
    if (raw.startsWith(PREFIX_BY_KIND.property)) {
        return { kind: 'property', fields: raw.slice(PREFIX_BY_KIND.property.length).split(':') };
    }
    return null;
}
/**
 * True if `raw` is a synthetic heritage/property marker — exactly the prior
 * `startsWith('__heritage__:') || startsWith('__property__:')` pair.
 */
export function isHeritageMarker(raw) {
    return raw.startsWith(PREFIX_BY_KIND.heritage) || raw.startsWith(PREFIX_BY_KIND.property);
}
