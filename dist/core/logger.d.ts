/**
 * Centralized structured logger for GitNexus.
 *
 * Wraps `pino` so the rest of the codebase imports from one place. Pino's
 * NDJSON output is structurally log-injection-resistant (CWE-117 / CodeQL
 * `js/log-injection`): each record is a single JSON object on its own line,
 * with all string field values JSON-escaped. This replaces hand-rolled
 * sanitizers (see PR #1329 history) that had recurring edge-case gaps
 * (undefined Error.message, U+2028/U+2029, ANSI/C0).
 *
 * Usage:
 *   import { logger, createLogger } from '../core/logger.js';
 *   logger.warn({ groupDir }, 'msg');
 *   const childLogger = createLogger('bridge-db', { debugEnvVar: 'GITNEXUS_DEBUG_BRIDGE' });
 *
 * Operator semantics:
 *   - Default level: 'info' (matches pino default; preserves visibility of
 *     existing `console.log` migrations)
 *   - When `opts.debugEnvVar` is set and that env var is truthy at
 *     createLogger time, that named child logs at level 'debug'
 *   - Output is NDJSON in production / CI / vitest. pino-pretty is used only
 *     when stdout is a TTY AND CI is unset AND VITEST is unset, so test
 *     and pipeline output stay parseable.
 *
 * Test capture:
 *   The exported `logger` singleton is a Proxy that forwards every call to a
 *   lazily-built pino instance. Tests use `_captureLogger()` to redirect that
 *   inner instance to a memory stream so they can assert on records the
 *   production code logged. See `gitnexus/test/unit/logger.test.ts` for the
 *   pattern.
 */
import { type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import { Writable } from 'node:stream';
export interface CreateLoggerOptions {
    /** When set, this env var (truthy at construction time) bumps level to 'debug'. */
    debugEnvVar?: string;
    /** Override destination stream — primarily for tests. */
    destination?: DestinationStream;
    /**
     * Explicit level for the destination-override path — primarily for tests that
     * need to capture below the default `info` (e.g. asserting a `debug` record).
     * Ignored unless `destination` is set; `debugEnvVar` still wins when truthy.
     */
    level?: string;
}
/**
 * Flush any buffered records on the default destination. Entry-point
 * shutdown handlers (`SIGINT` / `SIGTERM`) MUST call this before
 * `process.exit(N)` — otherwise async-buffered records are lost on hard
 * exit. No-op when the destination hasn't been constructed yet (logger
 * module imported but never emitted) or when called from `_captureLogger`
 * test mode (tests use an in-memory destination).
 */
export declare function flushLoggerSync(): void;
/**
 * Build the pino-pretty transport options. Internal — exported only so unit
 * tests can exercise the probe path without going through `shouldUsePretty()`
 * (which is structurally false under vitest).
 */
export declare function _tryBuildPrettyTransport(): LoggerOptions['transport'] | undefined;
/**
 * Create a named child logger. When `opts.destination` is provided it bypasses
 * the default stdout sink (useful for test capture). When `opts.debugEnvVar` is
 * set and truthy at call time, the child runs at 'debug' level.
 */
export declare function createLogger(name: string, opts?: CreateLoggerOptions): Logger;
/**
 * Default singleton logger (`name: 'gitnexus'`). Backed by a Proxy so test
 * capture (`_captureLogger()`) can redirect output without breaking modules
 * that already imported the singleton at module-load time.
 */
export declare const logger: Logger;
/**
 * Shape of a parsed pino record. `level`, `time`, and `msg` are always
 * present; `name` is set when emitted from a named child logger; arbitrary
 * additional fields appear when callers pass a structured first arg.
 *
 * Exported so test helpers and downstream skills can type-narrow capture
 * results without inline `Record<string, unknown>` casts.
 */
export interface PinoLogRecord {
    level: number;
    time: number;
    msg: string;
    name?: string;
    [key: string]: unknown;
}
/**
 * In-memory Writable used by `_captureLogger()` and by tests that build
 * their own pino destination. Exported so the shape lives in one place
 * (previously duplicated between this module and `logger.test.ts`).
 *
 * `text()` and `records()` are convenience helpers test code calls. They
 * don't appear in production hot paths — only test destinations capture
 * here — so the surface is intentionally small.
 */
export declare class MemoryWritable extends Writable {
    chunks: string[];
    _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void;
    /** Concatenate every captured write back into a single string. */
    text(): string;
    /** Parse captured writes as one NDJSON record per non-empty line. */
    records(): PinoLogRecord[];
}
export interface LoggerCapture {
    records(): PinoLogRecord[];
    text(): string;
    restore(): void;
}
/**
 * Test helper. Redirects the default `logger` singleton to an in-memory
 * stream and returns a capture object plus a restore function.
 *
 * Pattern:
 *   let cap: LoggerCapture;
 *   beforeEach(() => { cap = _captureLogger(); });
 *   afterEach(() => { cap.restore(); });
 *   it('warns', () => {
 *     fnUnderTest();
 *     expect(cap.records().some(r => r.msg?.includes('clamping'))).toBe(true);
 *   });
 *
 * Pass `level` (e.g. 'debug') to capture below the default 'info' — needed to
 * assert that a record was emitted at debug rather than merely absent.
 *
 * Not a public API; underscore-prefixed and called only from test code.
 * Throws if a previous capture is still active — see the body for context.
 */
export declare function _captureLogger(level?: string): LoggerCapture;
