import Parser from 'tree-sitter';
/**
 * Resolve a statically-derivable path argument to a literal path: a bare
 * string literal, a `URI.create("/x")` call, or a `UriComponentsBuilder`
 * fluent chain. Genuinely dynamic arguments → null.
 */
export declare function extractStaticPathExpression(node: Parser.SyntaxNode): string | null;
/**
 * Infer an OkHttp request verb by scanning the builder chain around the matched
 * `.url(...)` call: a `.get()/.head()/.post()/.put()/.delete()/.patch()` helper
 * (before or after `.url()`), or a `.method("VERB", …)` literal, wins. Returns
 * `'GET'` only when the chain has NO verb call at all (a bare `.url(...).build()`
 * — OkHttp's real default). Returns `null` for an explicit `.method(verb, …)`
 * whose verb is a non-literal: the verb is set but not statically resolvable, so
 * the caller skips the call rather than asserting a wrong GET (parity with the
 * WebClient long-form variable-bound-verb behavior, which also skips).
 */
export declare function inferOkHttpMethod(urlCall: Parser.SyntaxNode): string | null;
/**
 * Infer a Java-`HttpClient` request verb by walking UP the builder chain from the
 * matched `.uri(URI.create("..."))` call: the first `.GET()/.POST()/.PUT()/`
 * `.DELETE()/.HEAD()` verb-helper, or a `.method("VERB", body)` literal, wins.
 * Returns `'GET'` only when the chain has no verb call (a bare `.build()` — the
 * builder's real default). Returns `null` for an explicit `.method(verb, …)` with
 * a non-literal verb (skip, not a guessed GET). The scan is transparent to
 * neutral calls anywhere in the chain (`.header()`/`.timeout()`/`.version()`),
 * before or after `.uri()`, so neither a header/timeout hop nor a verb call's
 * position drops the contract.
 */
export declare function inferHttpClientMethod(uriCall: Parser.SyntaxNode): string | null;
/** True when `urlCall`'s receiver chain bottoms out on a `new Request.Builder()`
 *  object-creation (descending the `.object` chain past any intervening calls). */
export declare function okHttpUrlRootsAtBuilder(urlCall: Parser.SyntaxNode): boolean;
/** True when `uriCall`'s receiver chain includes a `HttpRequest.newBuilder()`. */
export declare function httpClientUriRootsAtNewBuilder(uriCall: Parser.SyntaxNode): boolean;
/** True when a `HttpRequest.newBuilder(URI.create(...))` chain ALSO calls `.uri(...)`
 *  later — a later `.uri()` overrides the constructor URI at runtime, so the
 *  constructor-arg path must NOT be emitted (the `.uri()` query emits the override). */
export declare function httpClientChainHasUriCall(newBuilderCall: Parser.SyntaxNode): boolean;
