/**
 * Server Mapping Configuration
 *
 * Reads getGlobalDir()/server-mapping.json to map repo names to service names.
 * Used in embedding text to enrich metadata with microservice context.
 */
/**
 * Read the server mapping file and return the serverName for a given repoName.
 * Returns undefined if no mapping exists.
 */
export declare const readServerMapping: (repoName: string) => Promise<string | undefined>;
/**
 * Clear the cached mapping (useful for testing or after file changes)
 */
export declare const clearServerMappingCache: () => void;
