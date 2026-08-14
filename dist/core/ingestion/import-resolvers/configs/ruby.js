/**
 * Ruby import resolution config.
 * Require/require_relative suffix matching — no standard fallback.
 */
import { SupportedLanguages } from '../../../../_shared/index.js';
import { suffixResolve } from '../utils.js';
/** Ruby require/require_relative resolution strategy. */
export const rubyRequireStrategy = (rawImportPath, _filePath, ctx) => {
    const pathParts = rawImportPath.replace(/^\.\//, '').split('/').filter(Boolean);
    const resolved = suffixResolve(pathParts, ctx.normalizedFileList, ctx.allFileList, ctx.index);
    return resolved ? { kind: 'files', files: [resolved] } : null;
};
export const rubyImportConfig = {
    language: SupportedLanguages.Ruby,
    strategies: [rubyRequireStrategy],
};
