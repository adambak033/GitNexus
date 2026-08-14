/**
 * Built-in TS/JS taint model (#2083 M3 U2, plan KTD7).
 *
 * The canonical Express/Node source/sink/sanitizer set plus the Java and
 * Python models, registered for their language ids via the EXPLICIT
 * {@link registerBuiltinTaintModels} seam — deliberately not an import
 * side-effect, so the U4 emit path controls WHEN registration happens (call
 * it once before the pdg window runs; it is idempotent — the registry is
 * last-write-wins on the same language id).
 *
 * `taintModelVersion` is a deterministic digest of the FULL model content
 * (entries, kinds, args, modules). It joins the RepoMeta `pdg` stamp in U5 so
 * that ANY model change — adding an entry, relabeling a kind — trips full
 * writeback on an existing `--pdg` index (R7): persisted findings must never
 * outlive the model that produced them.
 */
import type { SourceSinkSanitizerSpec } from './source-sink-config.js';
/**
 * The built-in TS/JS model. Module provenance uses bare specifier names —
 * the matcher normalizes the `node:` scheme prefix, so `import { exec } from
 * 'node:child_process'` resolves identically.
 */
export declare const TS_JS_TAINT_MODEL: SourceSinkSanitizerSpec;
/**
 * Deterministic digest of a spec's full content. Key order is canonicalized
 * (recursively sorted) so the version reflects CONTENT, not literal layout;
 * array order is semantic (entry identity) and intentionally preserved.
 */
export declare function computeTaintModelVersion(spec: SourceSinkSanitizerSpec): string;
export declare const BUILTIN_TAINT_MODELS: {
    readonly java: SourceSinkSanitizerSpec;
    readonly javascript: SourceSinkSanitizerSpec;
    readonly python: SourceSinkSanitizerSpec;
    readonly typescript: SourceSinkSanitizerSpec;
};
/**
 * Version stamp of every built-in model (joins the RepoMeta pdg key in U5).
 * Adding a language model must invalidate existing persisted taint findings.
 */
export declare const taintModelVersion: string;
/**
 * Register the built-in models for Java, TypeScript, JavaScript, and Python.
 * Explicit init seam for the U4 emit path (call before the pdg window
 * consumes the registry); idempotent. Other language ids remain unregistered
 * until they have a dedicated model.
 */
export declare function registerBuiltinTaintModels(): void;
