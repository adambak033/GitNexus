/** Shorter deadline for analyze's auto-install (interactive; must not stall the index run). */
export declare const ANALYZE_EMBEDDING_INSTALL_TIMEOUT_MS: number;
/**
 * Deadline for the on-demand npm install. An explicit
 * `GITNEXUS_EMBEDDING_INSTALL_TIMEOUT_MS` always wins (so a user on a slow
 * mirror can raise it); otherwise `defaultMs` applies. The default is generous
 * (the ONNX stack is a large registry fetch), but latency-sensitive callers
 * (analyze's auto-install) pass a shorter `defaultMs` so a blackholed proxy
 * can't stall the whole run for the full ten minutes. Mirrors
 * `getExtensionInstallTimeoutMs`.
 */
export declare const getEmbeddingInstallTimeoutMs: (defaultMs?: number) => number;
/**
 * User-level prefix the on-demand stack installs into. The env override is
 * `path.resolve`d once here (the single chokepoint) so a relative or empty
 * value can't poison the probes downstream — `createRequire` throws
 * `ERR_INVALID_ARG_VALUE` on a relative anchor, which otherwise made every
 * resolution report "not installed" and reinstall on every run. An empty or
 * whitespace-only value falls through to the default.
 */
export declare const getEmbeddingRuntimeDir: () => string;
/**
 * The version specs to install — read from gitnexus' own package.json
 * `optionalDependencies` so the on-demand install can never drift from what a
 * normal install would have provided. (The manifest ships in the tarball even
 * when npm pruned the packages themselves.)
 */
export declare const getEmbeddingStackSpecs: () => Record<string, string>;
export interface EmbeddingRuntimeResolution {
    /** 'package': the normally-installed copy; 'runtime-prefix': the on-demand copy. */
    source: 'package' | 'runtime-prefix';
}
/**
 * Whether a runtime-prefix-sourced stack can actually be loaded on this Node
 * (#2372). The prefix mechanism re-anchors bare specifiers via
 * `module.registerHooks`, absent before Node 22.15 / 23.5 — so on 22.0–22.14 and
 * 23.0–23.4 a populated prefix exists but the ESM loader can never reach it. A
 * package-sourced stack never needs the hook and is unaffected. CLI code
 * consumes this predicate (never the compat module directly) to keep messaging
 * truthful instead of promising a prefix runtime the loader can't use.
 */
export declare const isPrefixRuntimeLoadable: () => boolean;
/**
 * Where the embedding stack resolves from, or `null` when it is not (fully)
 * installed. Resolution only — nothing is imported, so this never loads native
 * code and is safe on every platform.
 */
export declare const resolveEmbeddingRuntime: () => EmbeddingRuntimeResolution | null;
/**
 * Idempotently register the resolution fallback that redirects the embedding
 * stack's bare specifiers to the runtime prefix when normal resolution fails.
 * Mirrors the onnxruntime-common fallback hook (#307): try the default
 * resolution first so a real, package-manager-installed copy always wins, and
 * only re-anchor at the prefix on ERR_MODULE_NOT_FOUND.
 *
 * Must be registered BEFORE the CUDA-13 redirect hook
 * (`ensureOnnxRuntimeNodeMatchesSystem`) — `registerHooks` runs the most
 * recently registered hook first, so registering this one earliest makes it
 * the last-resort fallback in the chain.
 */
export declare const ensureEmbeddingStackResolvable: () => void;
export interface EmbeddingInstallOptions {
    /**
     * Also fetch the CUDA GPU binaries: runs onnxruntime-node's postinstall
     * (NuGet download — set GLOBAL_AGENT_HTTPS_PROXY behind a proxy). Default
     * false: `--ignore-scripts` + ONNXRUNTIME_NODE_INSTALL=skip, so the install
     * touches only the npm registry and CPU embeddings work everywhere.
     */
    cuda?: boolean;
    /** Progress sink for npm's output lines. */
    onOutput?: (line: string) => void;
}
/** Pure command builder, exported for tests. */
export declare const buildEmbeddingInstallCommand: (opts?: EmbeddingInstallOptions) => {
    args: string[];
    env: NodeJS.ProcessEnv;
};
/**
 * Quote a single argument for the Windows `cmd.exe` shell (#2372). npm is a
 * `.cmd` shim, so the spawn must go through a shell (EINVAL otherwise since
 * CVE-2024-27980), and Node does NOT escape args under `shell: true` — a spaced
 * `--prefix` path splits, and cmd eats the `^` in `@pkg@^1.0.0` semver ranges.
 *
 * Rules (validated against Node source, MS cmd/CRT docs, BatBadBut, Rust std):
 * reject NUL/CR/LF and embedded `"` (both unrepresentable/unsafe at the cmd
 * layer, and `"` is illegal in Windows paths and npm specs); wrap in double
 * quotes when empty or containing whitespace/metacharacters; double the trailing
 * backslash run so the added closing quote is not itself escaped (`C:\` →
 * `"C:\\"`). `^` is literal inside cmd double quotes across all three parse
 * layers (cmd `/c` → npm.cmd's `%*` re-parse → node CRT argv). Two documented
 * ceilings quoting can't close: a defined `%VAR%` expands once at the first cmd
 * parse, and `!` expands only under registry-enabled delayed expansion — both
 * are the env-var owner's trust, out of the malicious-repo threat model.
 */
export declare const quoteWin32Arg: (arg: string) => string;
/**
 * Compose a full `cmd.exe` command line: the command stays unquoted (so
 * PATH/PATHEXT resolves a bare name or `.cmd` shim), args are individually
 * quoted. Passing this as spawn's first (only) string argument — no args array
 * — yields a byte-identical `cmd.exe /d /s /c "…"` line while avoiding DEP0190
 * (the runtime deprecation warning Node >=24 emits for
 * `spawn(file, args, {shell:true})`). Exported generically so the real-cmd.exe
 * round-trip test drives the exact same composition the npm spawn uses.
 */
export declare const composeWin32Command: (command: string, args: string[]) => string;
/** {@link composeWin32Command} for the on-demand npm install (`npm` stays unquoted). */
export declare const composeWin32NpmCommand: (args: string[]) => string;
/**
 * Install (or update) the embedding stack into the runtime prefix via the
 * user's npm — registry, mirror, and proxy configuration all apply. Rejects
 * with npm's tail output on failure or timeout.
 *
 * The child is bounded by `timeoutMs` (default {@link getEmbeddingInstallTimeoutMs})
 * and SIGKILLed — with its grandchildren — if it overruns, so a blackholed
 * proxy (the exact #2370 environment) can't hang the caller forever. It is also
 * killed if the parent exits mid-install, so a leftover npm can't keep writing
 * into the shared prefix.
 */
export declare const installEmbeddingRuntime: (opts?: EmbeddingInstallOptions, timeoutMs?: number) => Promise<void>;
