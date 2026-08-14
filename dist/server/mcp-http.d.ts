/**
 * MCP over HTTP — route mount helper for the web-UI server.
 *
 * Mounts the GitNexus MCP endpoint (/api/mcp) onto an existing Express
 * application. Session management lives in mcp/http-transport.ts, preserving
 * the established server/ → mcp/ dependency direction.
 *
 * Used by server/api.ts to wire up the full web server.
 */
import type { Express } from 'express';
import type { LocalBackend } from '../mcp/local/local-backend.js';
export declare function mountMCPEndpoints(app: Express, backend: LocalBackend): Promise<() => Promise<void>>;
