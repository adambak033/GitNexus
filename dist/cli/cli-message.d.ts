import { type CliMessageKey, type CliMessageVars } from './i18n/index.js';
/**
 * String-literal union of all `recoveryHint` tags emitted by the CLI.
 *
 * Centralized so a new recovery branch added in `analyze.ts` cannot land
 * without updating this union — TypeScript will reject the unknown literal
 * passed via `cliError({ recoveryHint: '...' })`. To add a new hint:
 *   1. Add the tag string to this union.
 *   2. Pass it as the `recoveryHint` field at the relevant `cliError`
 *      call site.
 *
 * Consumers can import this type to narrow log-record `recoveryHint`
 * fields without restating the literal list.
 */
export type RecoveryHint = 'wal-corruption' | 'wal-checkpoint-threshold' | 'lbug-wipe-failed' | 'lbug-page-size' | 'heap-oom-respawn' | 'native-worker-abort' | 'hf-endpoint-unreachable' | 'http-embedding-endpoint-error' | 'embedding-dims-invalid' | 'local-embedding-unsupported' | 'local-embedding-stack-missing' | 'large-repo' | 'npm-resolution' | 'module-not-found' | 'gitnexusrc-invalid' | 'default-branch-invalid' | 'index-lock-timeout' | 'undeclared-relation-pair';
/**
 * Common shape for the optional structured-field bag passed to
 * `cliError`/`cliWarn`/`cliInfo`. Typed so the `recoveryHint` slot is
 * checked against the {@link RecoveryHint} union.
 */
export interface CliMessageFields extends Record<string, unknown> {
    recoveryHint?: RecoveryHint;
}
/**
 * User-facing informational message. Use for banners, listening URLs,
 * and any message the user expects to read in plain text.
 */
export declare function cliInfo(msg: string, fields?: CliMessageFields): void;
/**
 * Key-based informational message. Keeps the legacy string API intact while
 * allowing commands to opt into localized user-facing stderr output.
 */
export declare function cliInfoKey(key: CliMessageKey, vars?: CliMessageVars, fields?: Record<string, unknown>): void;
/**
 * User-facing warning. Operator-actionable but non-fatal — `cliWarn`
 * indicates the command can still proceed in some form.
 */
export declare function cliWarn(msg: string, fields?: CliMessageFields): void;
export declare function cliWarnKey(key: CliMessageKey, vars?: CliMessageVars, fields?: Record<string, unknown>): void;
/**
 * User-facing error. Indicates the command cannot proceed; usually
 * paired with a non-zero exit code at the call site.
 */
export declare function cliError(msg: string, fields?: CliMessageFields): void;
export declare function cliErrorKey(key: CliMessageKey, vars?: CliMessageVars, fields?: Record<string, unknown>): void;
