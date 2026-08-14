/**
 * Per-workspace config for C# scope-resolution import targeting.
 *
 * Loaded once per analyze pass via `csharpScopeResolver.loadResolutionConfig`
 * and threaded into `resolveCsharpImportTarget`. The pure gate predicates live
 * in `../../csharp-namespace-gate.ts` (shared with the legacy DAG resolver).
 */
import { scanCSharpProject, csharpScanToEvidence, } from '../../language-config.js';
export async function loadCsharpResolutionConfig(repoRoot) {
    const scan = await scanCSharpProject(repoRoot);
    return {
        csharpConfigs: scan.configs,
        namespaces: csharpScanToEvidence(scan),
    };
}
