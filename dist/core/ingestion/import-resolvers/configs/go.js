/**
 * Go import resolution config.
 * Go-specific package strategy (go.mod), then standard fallback.
 */
import { SupportedLanguages } from '../../../../_shared/index.js';
import { createStandardStrategy } from '../standard.js';
import { resolveGoPackageDir, resolveGoPackage } from '../go.js';
/** Go-specific package resolution strategy — resolves go.mod-based package imports. */
export const goPackageStrategy = (rawImportPath, _filePath, ctx) => {
    const goModule = ctx.configs.goModule;
    if (goModule && rawImportPath.startsWith(goModule.modulePath)) {
        const pkgSuffix = resolveGoPackageDir(rawImportPath, goModule);
        if (pkgSuffix) {
            const pkgFiles = resolveGoPackage(rawImportPath, goModule, ctx.normalizedFileList, ctx.allFileList);
            if (pkgFiles.length > 0) {
                return { kind: 'package', files: pkgFiles, dirSuffix: pkgSuffix };
            }
        }
        // Fall through if no files found (package might be external)
    }
    return null;
};
export const goImportConfig = {
    language: SupportedLanguages.Go,
    strategies: [goPackageStrategy, createStandardStrategy(SupportedLanguages.Go)],
};
