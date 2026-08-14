/**
 * Ruby bare-call self-inference helper.
 *
 * Ruby makes `self` implicit for method calls inside instance and class bodies:
 * `serialize` inside `Account#call_serialize` means `self.serialize`. Other
 * supported languages make the receiver explicit in source (`this.x`, `self.x`),
 * so tree-sitter produces a member call directly. Ruby's bare identifier
 * produces either `callForm === 'free'` or `callForm === undefined` (body_statement
 * identifier captures where the @call node IS the @call.name node), and
 * `resolveFreeCall` does a global tiered name lookup — no MRO walk.
 *
 * This helper is a pure decision function consumed by the Ruby language
 * provider's `inferImplicitReceiver` hook. Shared pipeline code never imports
 * it directly — only `languages/ruby.ts` does.
 */
import type { SyntaxNode } from './ast-helpers.js';
import type { LanguageProvider } from '../language-provider.js';
/**
 * Rewrite suggestion returned by `maybeRewriteRubyBareCallToSelf`.
 *
 * `callForm` is always `'member'`; `receiverName` is always `'self'`.
 * `dispatchKind` controls the stage-4 ancestry view:
 * - `'instance'` → prepend → direct → include (normal MRO)
 * - `'singleton'` → extend providers only, no file-scoped fallback
 *
 * Consumed by `languages/ruby.ts § inferImplicitReceiver` (wraps into
 * `ImplicitReceiverOverride`; `dispatchKind` becomes the `hint` field).
 */
export interface SelfCallRewrite {
    readonly callForm: 'member';
    readonly receiverName: 'self';
    readonly receiverTypeName: string;
    /** `'singleton'` when the enclosing method is `def self.foo` / inside a
     *  `singleton_class` body; `'instance'` otherwise. Controls MRO ancestry
     *  view selection in stage-4 dispatch. */
    readonly dispatchKind: 'instance' | 'singleton';
}
/**
 * Pure decision function: should a bare Ruby call be rewritten as `self.method`?
 *
 * Returns a `SelfCallRewrite` when all gates pass; null otherwise.
 * Gates (all required): `callForm` is `'free'` or `undefined`, strategy is
 * `'ruby-mixin'`, `enclosingClassName` is non-null, name is not `'super'`,
 * name is not a built-in.
 *
 * Note: Ruby body-statement identifiers produce `callForm === undefined` because
 * the @call node IS the @call.name node in tree-sitter-ruby.
 *
 * Example: `calledName='serialize'` in `Account` instance method →
 * `{callForm:'member', receiverName:'self', receiverTypeName:'Account', dispatchKind:'instance'}`
 */
export declare function maybeRewriteRubyBareCallToSelf(calledName: string, callForm: 'free' | 'member' | 'constructor' | undefined, callNode: SyntaxNode, enclosingClassName: string | null, provider: Pick<LanguageProvider, 'isBuiltInName' | 'mroStrategy'>): SelfCallRewrite | null;
