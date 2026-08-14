import type { HeritageExtractionConfig, SupertypeShapeDescriptor } from '../../heritage-types.js';
/**
 * Ruby `class A < B` superclass shapes, and the class-name shapes for
 * `class Foo::Bar`. Both positions accept a bare `constant` or a
 * `scope_resolution` (`Base::Sup` / `Foo::Bar`); the normalizer reduces the
 * scope_resolution to its trailing constant.
 */
export declare const rubyHeritageShapes: SupertypeShapeDescriptor;
/**
 * Ruby heritage extraction config.
 *
 * Ruby expresses inheritance in two ways, and only one of them has
 * dedicated tree-sitter heritage captures:
 *
 * 1. Class inheritance (`class A < B`) produces standard
 *    `@heritage.extends` captures and flows through the generic
 *    capture-based `extract` hook (not defined here — the factory
 *    handles it).
 * 2. Mixin calls (`include`/`extend`/`prepend`) have no dedicated
 *    heritage captures; they surface as ordinary call sites. The
 *    `callBasedHeritage` hook below intercepts them before the call
 *    router, absorbing the mixin routing logic that previously lived
 *    in call-routing.ts (routeRubyCall).
 */
export declare const rubyHeritageConfig: HeritageExtractionConfig;
