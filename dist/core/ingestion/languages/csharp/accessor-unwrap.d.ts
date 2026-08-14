import type { ElementAccessRoute } from '../../scope-resolution/contract/scope-resolver.js';
/**
 * Resolve `data.Values` / `data.Keys` on a Dictionary-like receiver
 * to its element-type simple name. Returns `undefined` for any
 * receiver / accessor combination we don't recognize, letting the
 * compound-receiver pass fall through to the regular field walk.
 */
export declare function unwrapCsharpElementType(containerType: string, via: ElementAccessRoute): string | undefined;
