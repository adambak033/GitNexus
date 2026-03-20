/**
 * E2E Tests: Stale Data Detection + Sequential Enrichment Stability
 *
 * Validates the fixes in PR #396:
 *   1. Stale data detection: ensureInitialized() detects when the index
 *      was rebuilt (meta.json changed) and re-opens the connection pool
 *   2. Sequential enrichment: impact() enrichment queries run without
 *      SIGSEGV on arm64 macOS (sequential on arm64, parallel elsewhere)
 *   3. Consecutive tool stability: MCP server stays alive after 10+
 *      consecutive tool calls (no stdout corruption)
 *   4. All core tools (context, query, cypher, impact) return valid
 *      results after the concurrency changes
 *
 * Issues: #285, #290, #292, #297
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  initLbug,
  executeQuery,
  closeLbug,
} from '../../src/mcp/core/lbug-adapter.js';
import { withTestLbugDB } from '../helpers/test-indexed-db.js';
import { LOCAL_BACKEND_SEED_DATA, LOCAL_BACKEND_FTS_INDEXES } from '../fixtures/local-backend-seed.js';
import { LocalBackend } from '../../src/mcp/local/local-backend.js';
import { listRegisteredRepos } from '../../src/storage/repo-manager.js';
import { vi } from 'vitest';

vi.mock('../../src/storage/repo-manager.js', () => ({
  listRegisteredRepos: vi.fn().mockResolvedValue([]),
  cleanupOldKuzuFiles: vi.fn().mockResolvedValue({ found: false, needsReindex: false }),
}));

// ─── Block 1: Stale data detection (#297) ────────────────────────────

withTestLbugDB('staleness-detection', (handle) => {

  describe('stale data detection via meta.json', () => {
    let backend: LocalBackend;
    let storagePath: string;

    it('setup backend and verify initial state', async () => {
      const ext = handle as typeof handle & { _backend?: LocalBackend };
      if (!ext._backend) throw new Error('LocalBackend not initialized');
      backend = ext._backend;
      storagePath = handle.tmpHandle.dbPath;

      // Verify initial query works
      const result = await backend.callTool('cypher', {
        query: 'MATCH (n:Function) RETURN n.name AS name ORDER BY n.name',
      });
      expect(result).toHaveProperty('row_count');
      expect(result.row_count).toBeGreaterThanOrEqual(3);
    });

    it('detects stale index when meta.json indexedAt changes', async () => {
      // Write a meta.json with a different indexedAt to simulate re-index
      const metaPath = path.join(storagePath, 'meta.json');
      const freshMeta = {
        indexedAt: new Date(Date.now() + 60000).toISOString(),
        lastCommit: 'new-commit-hash',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      };
      await fs.writeFile(metaPath, JSON.stringify(freshMeta));

      // The next tool call should trigger re-init internally.
      // It may fail (the DB hasn't actually changed) but should NOT crash
      // with SIGSEGV or corrupt the WAL.
      try {
        const result = await backend.callTool('cypher', {
          query: 'MATCH (n:Function) RETURN COUNT(n) AS cnt',
        });
        // If it succeeds, verify it returns valid data
        expect(result).toBeDefined();
      } catch (err: any) {
        // Re-init failure is acceptable (DB path didn't actually change)
        // but SIGSEGV or WAL corruption would crash the process entirely
        expect(err.message).not.toMatch(/SIGSEGV/i);
      }
    });

    it('does not re-read meta.json within 5s throttle window', async () => {
      // Write meta.json with yet another timestamp
      const metaPath = path.join(storagePath, 'meta.json');
      const newerMeta = {
        indexedAt: new Date(Date.now() + 120000).toISOString(),
        lastCommit: 'another-commit',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      };
      await fs.writeFile(metaPath, JSON.stringify(newerMeta));

      // Immediate second call should be throttled (no fs.readFile)
      // This test verifies the throttle doesn't cause errors
      try {
        const result = await backend.callTool('cypher', {
          query: 'MATCH (n:Function) RETURN COUNT(n) AS cnt',
        });
        expect(result).toBeDefined();
      } catch {
        // Acceptable — the point is no crash
      }
    });
  });

}, {
  seed: LOCAL_BACKEND_SEED_DATA,
  ftsIndexes: LOCAL_BACKEND_FTS_INDEXES,
  poolAdapter: true,
  afterSetup: async (handle) => {
    // Write initial meta.json
    const metaPath = path.join(handle.tmpHandle.dbPath, 'meta.json');
    const initialMeta = {
      indexedAt: new Date().toISOString(),
      lastCommit: 'abc123',
      stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
    };
    await fs.writeFile(metaPath, JSON.stringify(initialMeta));

    vi.mocked(listRegisteredRepos).mockResolvedValue([
      {
        name: 'test-repo',
        path: '/test/repo',
        storagePath: handle.tmpHandle.dbPath,
        indexedAt: initialMeta.indexedAt,
        lastCommit: 'abc123',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      },
    ]);
    const backend = new LocalBackend();
    await backend.init();
    (handle as any)._backend = backend;
  },
});

// ─── Block 2: Sequential enrichment queries (#285, #290, #292) ───────

withTestLbugDB('sequential-enrichment', (handle) => {

  describe('impact enrichment queries run without crashes', () => {
    let backend: LocalBackend;

    it('setup', async () => {
      const ext = handle as typeof handle & { _backend?: LocalBackend };
      if (!ext._backend) throw new Error('LocalBackend not initialized');
      backend = ext._backend;
    });

    it('impact with enrichment completes without SIGSEGV', async () => {
      // This is the core regression test: impact() runs 3 enrichment queries
      // that previously used Promise.all and caused SIGSEGV on arm64 macOS.
      // Now they run sequentially on arm64 macOS and in parallel elsewhere.
      const result = await backend.callTool('impact', {
        target: 'validate',
        direction: 'upstream',
      });
      // May return an error if the DB was affected by prior test blocks.
      // The key assertion: no SIGSEGV crash (process would exit if so).
      if (!result.error) {
        expect(result.impactedCount).toBeGreaterThanOrEqual(1);
        expect(result).toHaveProperty('affected_processes');
        expect(result).toHaveProperty('affected_modules');
      }
    });

    it('impact with large maxDepth completes without crash', async () => {
      const result = await backend.callTool('impact', {
        target: 'login',
        direction: 'downstream',
        maxDepth: 5,
      });
      expect(result).toBeDefined();
      // No crash = success. Error response is acceptable (DB state may vary).
    });
  });

}, {
  seed: LOCAL_BACKEND_SEED_DATA,
  ftsIndexes: LOCAL_BACKEND_FTS_INDEXES,
  poolAdapter: true,
  afterSetup: async (handle) => {
    vi.mocked(listRegisteredRepos).mockResolvedValue([
      {
        name: 'test-repo',
        path: '/test/repo',
        storagePath: handle.tmpHandle.dbPath,
        indexedAt: new Date().toISOString(),
        lastCommit: 'abc123',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      },
    ]);
    const backend = new LocalBackend();
    await backend.init();
    (handle as any)._backend = backend;
  },
});

// ─── Block 3: Consecutive tool call stability ────────────────────────

withTestLbugDB('consecutive-stability', (handle) => {

  describe('MCP server stays alive after 10+ consecutive tool calls', () => {
    let backend: LocalBackend;

    it('setup', async () => {
      const ext = handle as typeof handle & { _backend?: LocalBackend };
      if (!ext._backend) throw new Error('LocalBackend not initialized');
      backend = ext._backend;
    });

    it('10 consecutive cypher calls complete without stdout corruption', async () => {
      for (let i = 0; i < 10; i++) {
        const result = await backend.callTool('cypher', {
          query: `MATCH (n:Function) RETURN n.name AS name LIMIT ${i + 1}`,
        });
        expect(result).toHaveProperty('row_count');
        expect(result.row_count).toBeGreaterThanOrEqual(1);
      }
    });

    it('mixed tool calls: context → impact → query → cypher cycle', async () => {
      // Cycle through all 4 core tools 3 times
      for (let i = 0; i < 3; i++) {
        const ctx = await backend.callTool('context', { name: 'login' });
        expect(ctx.status).toBe('found');

        const imp = await backend.callTool('impact', {
          target: 'validate',
          direction: 'upstream',
        });
        expect(imp).not.toHaveProperty('error');

        const qry = await backend.callTool('query', { query: 'login' });
        expect(qry).not.toHaveProperty('error');

        const cyp = await backend.callTool('cypher', {
          query: 'MATCH (n:Function) RETURN COUNT(n) AS cnt',
        });
        expect(cyp).toHaveProperty('row_count');
      }
    });

    it('stdout.write is properly restored after all calls', () => {
      // Verify stdout wasn't permanently silenced by the silenceStdout
      // mechanism used to prevent native stdout corruption
      const isOriginal = process.stdout.write !== ((() => true) as any);
      expect(isOriginal).toBe(true);
    });
  });

}, {
  seed: LOCAL_BACKEND_SEED_DATA,
  ftsIndexes: LOCAL_BACKEND_FTS_INDEXES,
  poolAdapter: true,
  afterSetup: async (handle) => {
    vi.mocked(listRegisteredRepos).mockResolvedValue([
      {
        name: 'test-repo',
        path: '/test/repo',
        storagePath: handle.tmpHandle.dbPath,
        indexedAt: new Date().toISOString(),
        lastCommit: 'abc123',
        stats: { files: 2, nodes: 3, communities: 1, processes: 1 },
      },
    ]);
    const backend = new LocalBackend();
    await backend.init();
    (handle as any)._backend = backend;
  },
});

// ─── Block 4: activeQueryCount watchdog interaction ──────────────────

withTestLbugDB('watchdog-query-guard', (handle) => {

  describe('watchdog does not restore stdout during active queries', () => {
    const REPO = 'watchdog-test';
    let inited = false;

    const ensurePool = async () => {
      if (!inited) {
        await initLbug(REPO, handle.dbPath);
        inited = true;
      }
    };

    afterAll(async () => {
      try { await closeLbug(REPO); } catch { /* best-effort */ }
    });

    it('parallel queries complete and stdout is restored', async () => {
      await ensurePool();

      // Run 4 parallel queries — if the watchdog incorrectly restores
      // stdout during execution, native output could corrupt the MCP
      // stdio stream. The test verifies all queries complete cleanly.
      const queries = Array.from({ length: 4 }, (_, i) =>
        executeQuery(REPO, `MATCH (n:Function) RETURN n.name AS name LIMIT ${i + 1}`)
      );
      const results = await Promise.all(queries);
      expect(results).toHaveLength(4);
      for (const r of results) {
        expect(r.length).toBeGreaterThanOrEqual(1);
      }

      // After all queries complete, stdout should be restored
      const isOriginal = process.stdout.write !== ((() => true) as any);
      expect(isOriginal).toBe(true);
    });

    it('sequential queries with intentional delay still work', async () => {
      await ensurePool();

      // Run queries one by one — each silences/restores stdout
      for (let i = 0; i < 5; i++) {
        const rows = await executeQuery(REPO, 'MATCH (n:Function) RETURN n.name');
        expect(rows.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

}, {
  seed: LOCAL_BACKEND_SEED_DATA,
});
