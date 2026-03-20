/**
 * Embedder Module (Read-Only)
 * 
 * Singleton factory for transformers.js embedding pipeline.
 * For MCP, we only need to compute query embeddings, not batch embed.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Model config
const MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EMBEDDING_DIMS = parseInt(process.env.GITNEXUS_EMBEDDING_DIMS ?? '384', 10);

// HTTP embedding config
const HTTP_URL = process.env.GITNEXUS_EMBEDDING_URL ?? '';
const HTTP_MODEL = process.env.GITNEXUS_EMBEDDING_MODEL ?? '';
const HTTP_KEY = process.env.GITNEXUS_EMBEDDING_API_KEY ?? 'unused';
const USE_HTTP = !!(HTTP_URL && HTTP_MODEL);

// Module-level state for singleton pattern
let embedderInstance: FeatureExtractionPipeline | null = null;
let isInitializing = false;
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Initialize the embedding model (lazy, on first search)
 */
export const initEmbedder = async (): Promise<FeatureExtractionPipeline> => {
  if (USE_HTTP) return null as unknown as FeatureExtractionPipeline;

  if (embedderInstance) {
    return embedderInstance;
  }

  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      env.allowLocalModels = false;
      
      console.error('GitNexus: Loading embedding model (first search may take a moment)...');

      // Try GPU first (DirectML on Windows, CUDA on Linux), fall back to CPU
      const isWindows = process.platform === 'win32';
      const gpuDevice = isWindows ? 'dml' : 'cuda';
      const devicesToTry: Array<'dml' | 'cuda' | 'cpu'> = [gpuDevice, 'cpu'];
      
      for (const device of devicesToTry) {
        try {
          // Silence stdout and stderr during model load — ONNX Runtime and transformers.js
          // may write progress/init messages that corrupt MCP stdio protocol or produce
          // noisy warnings (e.g. node assignment to execution providers).
          const origStdout = process.stdout.write;
          const origStderr = process.stderr.write;
          process.stdout.write = (() => true) as any;
          process.stderr.write = (() => true) as any;
          try {
            embedderInstance = await (pipeline as any)(
              'feature-extraction',
              MODEL_ID,
              {
                device: device,
                dtype: 'fp32',
              }
            );
          } finally {
            process.stdout.write = origStdout;
            process.stderr.write = origStderr;
          }
          console.error(`GitNexus: Embedding model loaded (${device})`);
          return embedderInstance!;
        } catch {
          if (device === 'cpu') throw new Error('Failed to load embedding model');
        }
      }

      throw new Error('No suitable device found');
    } catch (error) {
      isInitializing = false;
      initPromise = null;
      embedderInstance = null;
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
};

/**
 * Check if embedder is ready
 */
export const isEmbedderReady = (): boolean => USE_HTTP || embedderInstance !== null;

/**
 * Embed a query text for semantic search
 */
export const embedQuery = async (query: string): Promise<number[]> => {
  if (USE_HTTP) {
    const resp = await fetch(`${HTTP_URL.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HTTP_KEY}`,
      },
      body: JSON.stringify({ input: [query], model: HTTP_MODEL }),
    });
    if (!resp.ok) throw new Error(`Embedding endpoint ${resp.status}`);
    const data = (await resp.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  const embedder = await initEmbedder();
  
  const result = await embedder(query, {
    pooling: 'mean',
    normalize: true,
  });
  
  return Array.from(result.data as ArrayLike<number>);
};

/**
 * Get embedding dimensions
 */
export const getEmbeddingDims = (): number => EMBEDDING_DIMS;

/**
 * Cleanup embedder
 */
export const disposeEmbedder = async (): Promise<void> => {
  if (embedderInstance) {
    try {
      if ('dispose' in embedderInstance && typeof embedderInstance.dispose === 'function') {
        await embedderInstance.dispose();
      }
    } catch {}
    embedderInstance = null;
    initPromise = null;
  }
};
