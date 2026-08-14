/**
 * Inline ORM query extraction (sequential fallback path).
 *
 * Extracts Prisma and Supabase query calls from source content using
 * regex patterns. Used by the sequential parse path when workers are
 * not available — the worker path extracts ORM queries via tree-sitter
 * queries instead.
 *
 * @module
 */
import type { ExtractedORMQuery } from '../workers/parse-worker.js';
/**
 * Extract ORM query calls from file content using regex.
 *
 * Fast-path: skips files that don't contain `prisma.` or `supabase.from`.
 * Results are appended to the `out` array (push pattern avoids allocation).
 *
 * @param filePath  Relative path of the source file
 * @param content   File content string
 * @param out       Output array to append extracted queries to
 */
export declare function extractORMQueriesInline(filePath: string, content: string, out: ExtractedORMQuery[]): void;
