import type { MethodExtractor, MethodExtractionConfig } from '../method-types.js';
/**
 * Create a MethodExtractor from a declarative config.
 *
 * @throws {Error} if `typeDeclarationNodes` contains a static-implying owner
 *   type (companion_object / object_declaration / singleton_class) that is
 *   not covered by `staticOwnerTypes`. The guard fires once per language at
 *   provider construction to prevent silent `isStatic=false` regressions. See
 *   `STATIC_IMPLYING_OWNER_TYPES` for the exact opt-out convention.
 */
export declare function createMethodExtractor(config: MethodExtractionConfig): MethodExtractor;
