import { type ExtensionLoadDiagnosis } from './extension-load-error.js';
/**
 * Lifecycle policy for an optional DuckDB extension.
 *
 * - `auto`     — try `LOAD`, fall back to one bounded out-of-process `INSTALL`
 *                attempt per process if `LOAD` fails. Default for analyze.
 * - `load-only`— try `LOAD` only; never spawn an installer. Used by serve/MCP
 *                read paths so user queries never block on a network install.
 * - `never`    — skip the extension entirely. Operators can use this to
 *                forcibly disable optional search features.
 */
export type ExtensionInstallPolicy = 'auto' | 'load-only' | 'never';
export interface ExtensionInstallResult {
    success: boolean;
    timedOut: boolean;
    message: string;
}
/** Snapshot of one optional extension's resolved capability state. */
export interface ExtensionCapability {
    name: string;
    loaded: boolean;
    /** Human-readable reason when `loaded` is false. */
    reason?: string;
    /**
     * Classified diagnosis of `reason`, computed ONCE at mark-unavailable time so
     * per-request surfaces (ftsDegradedWarning on /api/search + MCP query) read the
     * cached remedy instead of re-inspecting the extension file on every call (#2383 F3).
     */
    diagnosis?: ExtensionLoadDiagnosis;
}
/** Per-call overrides applied on top of `ExtensionManager` defaults. */
export interface ExtensionEnsureOptions {
    policy?: ExtensionInstallPolicy;
    installTimeoutMs?: number;
    /**
     * Speculative probe: log an unavailable outcome at debug level instead of
     * warn, and do not consume the once-per-(extension, reason) warn budget.
     *
     * Set only by callers that do NOT own the extension's lifecycle and know a
     * later owner will retry with an install-capable policy — currently the
     * writable `initLbug` pre-load, whose miss on a cold cache is expected and
     * is fixed moments later by analyze Phase 3. Never set it on a path where
     * the failure is the final answer (serve/MCP read paths), or a real
     * degradation goes unreported.
     */
    quiet?: boolean;
}
export interface ExtensionManagerOptions {
    policy?: ExtensionInstallPolicy;
    installTimeoutMs?: number;
    installExtension?: (extensionName: string, timeoutMs: number, loadError?: string) => Promise<ExtensionInstallResult>;
    warn?: (message: string) => void;
}
export declare const getExtensionInstallPolicy: () => ExtensionInstallPolicy;
/**
 * Install policy for the **analyze (write) path**.
 *
 * The global default (`resolvePolicyFromEnv`) is `load-only` so serve/query
 * read paths never require outbound network access (PR #1161, offline-first).
 * The analyze path is different: it owns building the search indexes, so it
 * defaults to `auto` — LOAD the extension if present, otherwise attempt one
 * bounded out-of-process INSTALL. This keeps FTS symmetric with the
 * VECTOR/embeddings path (which already defaults to `auto`) and matches the
 * #726 contract. An explicit `GITNEXUS_LBUG_EXTENSION_INSTALL` value still
 * wins, so operators can force `load-only`/`never` for fully offline analyze;
 * `auto` LOADs-first, so offline machines still degrade gracefully when the
 * INSTALL cannot reach the network.
 */
export declare const resolveAnalyzeInstallPolicy: () => ExtensionInstallPolicy;
export declare const getExtensionInstallTimeoutMs: () => number;
export declare const getExtensionInstallChildProcessArgs: (extensionName: string, maxDbSize?: number) => string[];
/**
 * Run `INSTALL <extension>` in a short-lived child Node process so the parent
 * event loop is never blocked by DuckDB's synchronous network call.
 *
 * The child opens its own scratch LadybugDB, executes the install, and exits.
 * If the child exceeds `timeoutMs` the parent kills it with SIGKILL and
 * resolves with `timedOut: true`.
 */
export declare const installDuckDbExtensionOutOfProcess: (extensionName: string, timeoutMs?: number, loadError?: string) => Promise<ExtensionInstallResult>;
/**
 * Centralized lifecycle manager for optional LadybugDB extensions.
 *
 * Always tries `LOAD EXTENSION <name>` first — it is per-connection,
 * idempotent, and never touches the network. If `LOAD` fails and the active
 * policy permits, the manager runs a single bounded out-of-process `INSTALL`
 * attempt per process and retries `LOAD`. Capability outcomes are cached so
 * unavailable extensions degrade search features without ever blocking
 * subsequent analyze or query calls.
 *
 * Policy precedence (most specific wins):
 *   per-call `opts.policy` → constructor `options.policy` → env → `load-only`
 */
export declare class ExtensionManager {
    private readonly options;
    private readonly capabilities;
    private readonly installAttempted;
    private readonly warnedKeys;
    constructor(options?: ExtensionManagerOptions);
    /** Reset cached capability and install state. Test-only. */
    reset(): void;
    /** Snapshot of currently-known optional extension capabilities. */
    getCapabilities(): ExtensionCapability[];
    /**
     * Ensure an optional extension is loaded on the supplied connection.
     *
     * Returns `true` when the extension is usable on `query`, `false` when it
     * is unavailable. Never throws on install failure — analyze and query
     * paths are expected to degrade gracefully.
     */
    ensure(query: (sql: string) => Promise<unknown>, name: string, label: string, opts?: ExtensionEnsureOptions): Promise<boolean>;
    /**
     * Attempt `LOAD EXTENSION <name>`; returns `null` on success and the
     * collapsed error message on failure. The message is the load-side ground
     * truth — LadybugDB distinguishes a missing extension file from a present
     * but unloadable one (wrong platform, truncated download, version mismatch),
     * and discarding it left users staring at "not pre-installed" when the file
     * existed all along (#2374).
     */
    private tryLoad;
    private markLoaded;
    private markUnavailable;
}
/** Process-wide singleton shared by core and pool adapters. */
export declare const extensionManager: ExtensionManager;
/** Snapshot of which optional DuckDB extensions are loaded in this process. */
export declare const getExtensionCapabilities: () => ExtensionCapability[];
/**
 * One optional extension's capability record, or `undefined` when nothing in
 * this process has resolved it yet.
 *
 * `getExtensionCapabilities().find((c) => c.name === …)` was spelled out at five
 * call sites across four modules (#2841 review), each re-deriving the same
 * lookup — and each free to drift on the extension NAME, which is the one string
 * the lookup is keyed on. Keep the name in one place.
 */
export declare const getExtensionCapability: (name: string) => ExtensionCapability | undefined;
/**
 * {@link getExtensionCapability} for the FTS extension — the only extension
 * whose capability record is read outside this module (degrade warnings, the
 * `--repair-fts` reporting path, and `dropFTSIndex`'s remedy lookup), so the
 * `'fts'` spelling itself lives here rather than at each of them.
 */
export declare const getFtsCapability: () => ExtensionCapability | undefined;
/** Test-only: clear the singleton's cached capability and install state. */
export declare const resetExtensionState: () => void;
