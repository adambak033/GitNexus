/**
 * Per-workspace config for C# scope-resolution import targeting.
 *
 * Loaded once per analyze pass via `csharpScopeResolver.loadResolutionConfig`
 * and threaded into `resolveCsharpImportTarget`. The pure gate predicates live
 * in `../../csharp-namespace-gate.ts` (shared with the legacy DAG resolver).
 */
import { type CSharpProjectConfig, type CSharpNamespaceEvidence } from '../../language-config.js';
export interface CsharpResolutionConfig {
    readonly csharpConfigs: readonly CSharpProjectConfig[];
    /** In-repo declared-namespace evidence gating suffix-fallback resolution (#1881). */
    readonly namespaces?: CSharpNamespaceEvidence;
}
export declare function loadCsharpResolutionConfig(repoRoot: string): Promise<CsharpResolutionConfig>;
