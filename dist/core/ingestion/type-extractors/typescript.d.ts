import type { LanguageTypeConfig } from './types.js';
/**
 * Ordinary functions own their `this`; arrows do not (#2701).
 *
 * ECMA-262 gives an arrow `[[ThisMode]] = lexical` — it has no `this` binding
 * in its environment record, so the lookup passes through to the enclosing
 * environment. Every other function form binds `this` at call time, so
 * `this.m()` inside one does NOT reach the enclosing class. That is exactly
 * the distinction `tsc` draws by resolving `this` through `getThisContainer`
 * with `includeArrowFunctions = false`.
 *
 * `method_definition` is deliberately absent: it is the construct that binds
 * `this` TO the enclosing class, so the walk must pass through it and stop at
 * the class. (Unlike the scope-layer marker in `typescript/query.ts`, which
 * can list it because a method's own `this` typeBinding is consulted first.)
 *
 * Kept in sync with `@receiver-owner.this` in `languages/typescript/query.ts`
 * and `languages/javascript/query.ts` — the two layers must agree or a call
 * suppressed by one is re-introduced by the other.
 */
export declare const THIS_BOUNDARY_NODE_TYPES: ReadonlySet<string>;
export declare const typeConfig: LanguageTypeConfig;
