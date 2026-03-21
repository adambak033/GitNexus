import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEmbeddingDims, isEmbedderReady } from '../../src/mcp/core/embedder.js';

describe('HTTP embedding backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe('MCP embedder', () => {
    it('returns 384 dimensions by default', () => {
      expect(getEmbeddingDims()).toBe(384);
    });

    it('returns false before initialization', () => {
      expect(isEmbedderReady()).toBe(false);
    });

    it('returns true when HTTP environment variables are set', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://localhost:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';
      const mod = await import('../../src/mcp/core/embedder.js');
      expect(mod.isEmbedderReady()).toBe(true);
      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('reads custom dimensions from environment', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://localhost:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';
      process.env.GITNEXUS_EMBEDDING_DIMS = '1024';
      const mod = await import('../../src/mcp/core/embedder.js');
      expect(mod.getEmbeddingDims()).toBe(1024);
      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
      delete process.env.GITNEXUS_EMBEDDING_DIMS;
    });

    it('retries query on transient server error', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const ok = { ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(ok));

      const mod = await import('../../src/mcp/core/embedder.js');
      const result = await mod.embedQuery('test query');

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([0.1, 0.2]);

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });
  });

  describe('core embedder HTTP path', () => {
    it('sends correct request payload', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';
      process.env.GITNEXUS_EMBEDDING_API_KEY = 'test-key';

      const mockEmbedding = Array.from({ length: 384 }, (_, i) => i * 0.001);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: mockEmbedding }] }),
      }));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      const result = await embedText('test text');

      expect(fetch).toHaveBeenCalledOnce();
      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.input).toEqual(['test text']);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(384);

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
      delete process.env.GITNEXUS_EMBEDDING_API_KEY;
    });

    it('retries on server error', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const ok = { ok: true, json: async () => ({ data: [{ embedding: [0.1] }] }) };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce(ok));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      await embedText('test');
      expect(fetch).toHaveBeenCalledTimes(2);

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('retries on rate limit', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const ok = { ok: true, json: async () => ({ data: [{ embedding: [0.1] }] }) };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce(ok));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      await embedText('test');
      expect(fetch).toHaveBeenCalledTimes(2);

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('throws when all retries are exhausted', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      await expect(embedText('test')).rejects.toThrow('500');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('excludes API key from error messages', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';
      process.env.GITNEXUS_EMBEDDING_API_KEY = 'secret-key-12345';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      try {
        await embedText('test');
      } catch (e: any) {
        expect(e.message).not.toContain('secret-key-12345');
        expect(e.message).not.toContain('Authorization');
      }

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
      delete process.env.GITNEXUS_EMBEDDING_API_KEY;
    });

    it('includes abort signal for timeout', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
      }));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      await embedText('test');

      const opts = (fetch as any).mock.calls[0][1];
      expect(opts.signal).toBeDefined();

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('splits large inputs into batches', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const makeResp = (n: number) => ({
        ok: true,
        json: async () => ({ data: Array.from({ length: n }, () => ({ embedding: [0.1] })) }),
      });
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(makeResp(64))
        .mockResolvedValueOnce(makeResp(6)));

      const { embedBatch } = await import('../../src/core/embeddings/embedder.js');
      const results = await embedBatch(Array.from({ length: 70 }, (_, i) => `text ${i}`));

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(70);

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('rejects initEmbedder when using HTTP backend', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const { initEmbedder } = await import('../../src/core/embeddings/embedder.js');
      await expect(initEmbedder()).rejects.toThrow('HTTP mode');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('rejects getEmbedder when using HTTP backend', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      const { getEmbedder } = await import('../../src/core/embeddings/embedder.js');
      expect(() => getEmbedder()).toThrow('HTTP embedding mode');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('throws on empty response from endpoint', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      }));

      const mod = await import('../../src/mcp/core/embedder.js');
      await expect(mod.embedQuery('test')).rejects.toThrow('empty response');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('throws when endpoint returns fewer embeddings than texts', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1] }] }),
      }));

      const { embedBatch } = await import('../../src/core/embeddings/embedder.js');
      await expect(embedBatch(['text1', 'text2', 'text3'])).rejects.toThrow('1 vectors for 3 texts');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
    });

    it('throws on dimension mismatch when GITNEXUS_EMBEDDING_DIMS is set', async () => {
      process.env.GITNEXUS_EMBEDDING_URL = 'http://test:8080/v1';
      process.env.GITNEXUS_EMBEDDING_MODEL = 'test-model';
      process.env.GITNEXUS_EMBEDDING_DIMS = '512';

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      }));

      const { embedText } = await import('../../src/core/embeddings/embedder.js');
      await expect(embedText('test')).rejects.toThrow('Embedding dimension mismatch');

      delete process.env.GITNEXUS_EMBEDDING_URL;
      delete process.env.GITNEXUS_EMBEDDING_MODEL;
      delete process.env.GITNEXUS_EMBEDDING_DIMS;
    });
  });

  describe('schema dimensions', () => {
    it('defaults to 384 dimensions', async () => {
      const { EMBEDDING_DIMS } = await import('../../src/core/lbug/schema.js');
      expect(EMBEDDING_DIMS).toBe(384);
    });

    it('reads dimensions from environment variable', async () => {
      process.env.GITNEXUS_EMBEDDING_DIMS = '1024';
      const { EMBEDDING_DIMS } = await import('../../src/core/lbug/schema.js');
      expect(EMBEDDING_DIMS).toBe(1024);
      delete process.env.GITNEXUS_EMBEDDING_DIMS;
    });
  });
});
