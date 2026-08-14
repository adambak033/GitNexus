import type { ScopeId } from '../../../../_shared/index.js';
/** Record a scope id as a companion-object scope for the given file. */
export declare function markCompanionScope(filePath: string, scopeId: ScopeId): void;
/** Check whether `scopeId` belongs to a companion-object scope in `filePath`. */
export declare function isCompanionScope(filePath: string, scopeId: ScopeId): boolean;
/**
 * Snapshot the companion-object scope ids recorded for `filePath` as a plain
 * array (for the worker→main capture side-channel, #1983). Returns an empty
 * array when the file recorded no companion scopes. See
 * `capture-side-channel.ts`.
 */
export declare function getCompanionScopesForFile(filePath: string): ScopeId[];
/** Clear all tracked companion scopes (for testing). */
export declare function clearCompanionScopes(): void;
