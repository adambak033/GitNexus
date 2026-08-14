/**
 * Status Command
 *
 * Shows the indexing status of the current repository.
 */
export interface StatusOptions {
    json?: boolean;
}
export declare const statusCommand: (options?: StatusOptions) => Promise<void>;
