import type { ParsedFile } from '../../../../_shared/index.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { JvmPackageFact } from './package-facts.js';
export interface JvmPackageSiblingOptions {
    readonly languageLabel: string;
    readonly getPackageFact: (filePath: string) => JvmPackageFact | undefined;
}
export interface JvmPackageSiblingVisibility {
    readonly populateNamespaceSiblings: (parsedFiles: readonly ParsedFile[], indexes: ScopeResolutionIndexes, ctx: {
        readonly fileContents: ReadonlyMap<string, string>;
    }) => void;
    readonly isVisibilityIncomplete: (filePath: string) => boolean;
}
export declare function createJvmPackageSiblingVisibility(options: JvmPackageSiblingOptions): JvmPackageSiblingVisibility;
