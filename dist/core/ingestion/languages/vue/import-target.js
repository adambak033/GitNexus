/**
 * Import-target resolver for Vue SFCs (RFC #909 Ring 3, issue #940).
 *
 * `<script>` / `<script setup>` blocks are TypeScript or plain JavaScript, so
 * resolution is TypeScript's: the same tsconfig `paths`/`baseUrl` rules and the
 * same `package.json` manifests. `.vue` imports are written with an explicit
 * extension (`'./Button.vue'`) and `.vue` is in the candidate list, so no
 * Vue-specific guessing is required — the exact-path branch finds them first.
 */
import { resolveTsTarget } from '../typescript/import-target.js';
/** Build the Vue `resolveImportTarget` adapter. */
export function makeVueResolveImportTarget() {
    return (targetRaw, fromFile, allFilePaths, resolutionConfig) => {
        const cfg = resolutionConfig;
        return resolveTsTarget(targetRaw, {
            fromFile,
            allFilePaths,
            tsconfigs: cfg?.tsconfigs ?? null,
            nodeWorkspacePackages: cfg?.nodeWorkspacePackages ?? null,
        });
    };
}
