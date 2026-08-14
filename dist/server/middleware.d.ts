/**
 * Shared Express route guards (alongside createRouteLimiter in validation.ts),
 * plus the `serve` configuration surface they read: GITNEXUS_PUBLIC_ORIGIN and
 * GITNEXUS_TRUST_PROXY.
 */
import type { Request, Response } from 'express';
/**
 * Canonicalize a configured host — `--host`, or the one inside
 * {@link PUBLIC_ORIGIN_ENV} — into the form a browser `Origin` hostname takes
 * after WHATWG URL parsing, so the comparisons in
 * {@link createWriteOriginGuard} can use a plain `===`.
 *
 * Returns `undefined` when the host carries no single comparable identity:
 *   - empty / not provided
 *   - a wildcard bind (`0.0.0.0`, `::`, expanded `0:0:0:0:0:0:0:0`) — the server
 *     listens on every interface and has no one address a browser Origin maps to,
 *     so writes stay loopback-only (we deliberately do NOT trust the whole subnet)
 *   - an unparseable value
 *
 * Otherwise returns `new URL(...).hostname` (lowercased, IPv6 bracketed and
 * compressed) — provably identical to how the request Origin is parsed below.
 * Hand-rolling lowercase + bracketing is insufficient: it fails to compress
 * non-canonical IPv6 forms (e.g. `fe80:0:0:0:0:0:0:1`, `::ffff:127.0.0.1`).
 */
export declare function normalizeBoundHost(boundHost?: string): string | undefined;
/**
 * Browser origin a hosted deployment is reached through. A wildcard bind makes
 * {@link normalizeBoundHost} undefined, so writes would stay loopback-only.
 */
export declare const PUBLIC_ORIGIN_ENV = "GITNEXUS_PUBLIC_ORIGIN";
/**
 * Matches a parsed browser `Origin` against {@link PUBLIC_ORIGIN_ENV}. Carries
 * the hostname the env value resolved to, so startup can log what it parsed.
 */
export interface PublicOriginMatcher {
    readonly hostname: string;
    matches(origin: URL): boolean;
}
/**
 * Build a matcher for {@link PUBLIC_ORIGIN_ENV}. Compares hostname and scheme
 * always — a value with no scheme is read as `https`, never as either — and
 * port only when the configured value carried an explicit one.
 *
 * `undefined` when unset or not a single reachable host, mirroring
 * {@link normalizeBoundHost}: an invalid origin must never widen the
 * allow-list, and must not read as a configured one either.
 */
export declare function createPublicOriginMatcher(rawOrigin?: string): PublicOriginMatcher | undefined;
/**
 * Restrict a route to the browser origins this server trusts. Allows:
 *   - loopback (`localhost`, `127.0.0.1`, `[::1]`)
 *   - the server's own bound host (when non-loopback, e.g. a LAN IP)
 *   - the configured public origin ({@link PUBLIC_ORIGIN_ENV}), if any
 *
 * Non-browser requests (no Origin header, e.g. curl / the CLI) pass through.
 * This closes cross-origin reach to write routes without affecting read routes.
 *
 * Loopback stays port-agnostic — the dev UI and the server run on different
 * ports — but the bound host is matched on its port too, when one is given.
 *
 * @param boundHost - The hostname/IP the server is listening on (from
 *   `createServer`'s `host` parameter). When `undefined`, `'localhost'`, or a
 *   wildcard (`0.0.0.0`/`::`), only loopback origins are admitted.
 * @param boundPort - The port the server actually listens on. Omit it — and
 *   match the bound host on any port — when that is not known, as it is not
 *   for an ephemeral `--port 0` bind.
 */
export declare function createWriteOriginGuard(boundHost?: string, boundPort?: number): (req: Request, res: Response, next: () => void) => void;
/**
 * Whether `serve` has any request authentication configured.
 *
 * Nothing can configure it yet: `serve` has no authentication of any kind, and
 * {@link createWriteOriginGuard} passes every request that carries no `Origin`
 * header, so `curl` reaches `POST /api/analyze` and `DELETE /api/repo`
 * unauthenticated. That has been safe only because `serve` bound loopback.
 *
 * So this returns `false` unconditionally, and it is a placeholder on purpose:
 * the `serve` auth change replaces this body, and {@link assertServeAuthForPublicOrigin}
 * and its tests then hold without being rewritten.
 */
export declare function isServeAuthConfigured(): boolean;
/**
 * Refuse to start when {@link PUBLIC_ORIGIN_ENV} is set and no `serve`
 * authentication is configured.
 *
 * {@link PUBLIC_ORIGIN_ENV} is the setting that makes a public bind usable — it
 * is what admits a non-loopback browser origin to the write routes. Until
 * {@link isServeAuthConfigured} can return `true`, setting it opens the door
 * with nothing behind it, so the door does not open at all. There is
 * deliberately no override flag: an escape hatch is the thing an operator sets
 * once and forgets, which is exactly the state this guards against.
 *
 * @throws when {@link PUBLIC_ORIGIN_ENV} is set without authentication. `serve`
 *   surfaces it as `serve.startFailed` and exits non-zero.
 */
export declare function assertServeAuthForPublicOrigin(): void;
/**
 * Report at startup what {@link createWriteOriginGuard} will admit, so an
 * operator can see it without reproducing a 403. A wildcard bind always warns —
 * gating that on {@link PUBLIC_ORIGIN_ENV} being constructible would diagnose a
 * misconfigured value worse than an absent one.
 */
export declare function logOriginPolicy(boundHost?: string): void;
/** Loopback + RFC1918 + link-local: the hops a self-hosted install sees. */
export declare const DEFAULT_TRUST_PROXY = "loopback, linklocal, uniquelocal";
/** Overrides {@link DEFAULT_TRUST_PROXY}; a public cloud LB needs it set. */
export declare const TRUST_PROXY_ENV = "GITNEXUS_TRUST_PROXY";
/**
 * Sanity ceiling on a hop count, well past any real proxy chain — it exists to
 * catch a digit string long enough to overflow to `Infinity`, not to make any
 * value under it safe. The correct hop count is the exact number of proxies you
 * control; each extra hop hands the caller one more entry of the chain.
 */
export declare const MAX_TRUST_PROXY_HOPS = 16;
/**
 * Resolve {@link TRUST_PROXY_ENV} to a value Express accepts for `trust proxy`:
 * `false` (`false`/`no`/`off`, and a `0` hop count), a hop count in
 * `1..{@link MAX_TRUST_PROXY_HOPS}`, or a proxy list Express can compile.
 * Anything else warns and returns {@link DEFAULT_TRUST_PROXY}. Express compiles
 * this value inside `app.set`, so an unvalidated bad one takes `serve` down at
 * startup; a number it accepts without any range check at all.
 *
 * `true` is rejected, not accepted-with-a-warning. It makes `req.ip` the
 * client-controlled leftmost `X-Forwarded-For` entry, so a spoofed chain earns a
 * fresh rate-limit key per request — and the limiter is the only thing in front
 * of `/api/analyze` and `/api/embed`, both of which spawn workers. It is also
 * not a working configuration: express-rate-limit's own `validations.trustProxy`
 * throws `ERR_ERL_PERMISSIVE_TRUST_PROXY` on it. Any real chain has a knowable
 * length, so a hop count or a proxy list covers every legitimate case.
 */
export declare function resolveTrustProxy(raw?: string): string | number | boolean;
/**
 * Warn when the rate limiter is about to key every request to the same address.
 *
 * {@link resolveTrustProxy} cannot detect this — it sees the env value and not
 * what the server bound. A non-loopback bind is the shape of a deployment behind
 * a load balancer, and {@link DEFAULT_TRUST_PROXY} matches only loopback and the
 * private ranges, so a cloud LB outside them is never trusted: `req.ip` is the
 * LB on every request and the per-IP limit silently becomes one global limit.
 *
 * Silent when {@link TRUST_PROXY_ENV} is set — including to a value that then
 * fails validation, which {@link resolveTrustProxy} has already warned about.
 *
 * @param boundHost - `createServer`'s `host`. A wildcard bind warns too: it
 *   accepts traffic on every interface, a load balancer included.
 */
export declare function warnIfRateLimitKeysCollapse(boundHost?: string): void;
