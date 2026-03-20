import { createKnowledgeGraph } from '../graph/graph.js';
import { processStructure } from './structure-processor.js';
import { processParsing } from './parsing-processor.js';
import {
  processImports,
  processImportsFromExtracted,
  buildImportResolutionContext
} from './import-processor.js';
import { processCalls, processCallsFromExtracted, processAssignmentsFromExtracted, processRoutesFromExtracted, seedCrossFileReceiverTypes, buildImportedReturnTypes, type ExportedTypeMap, buildExportedTypeMapFromGraph } from './call-processor.js';
import { processHeritage, processHeritageFromExtracted } from './heritage-processor.js';
import { computeMRO } from './mro-processor.js';
import { processCommunities } from './community-processor.js';
import { processProcesses } from './process-processor.js';
import { createResolutionContext } from './resolution-context.js';
import { createASTCache } from './ast-cache.js';
import { PipelineProgress, PipelineResult } from '../../types/pipeline.js';
import { walkRepositoryPaths, readFileContents } from './filesystem-walker.js';
import { getLanguageFromFilename } from './utils.js';
import { isLanguageAvailable } from '../tree-sitter/parser-loader.js';
import { createWorkerPool, WorkerPool } from './workers/worker-pool.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const isDev = process.env.NODE_ENV === 'development';

/** A group of files with no mutual dependencies, safe to process in parallel. */
type IndependentFileGroup = readonly string[];

/** Kahn's algorithm: returns files grouped by topological level.
 *  Files in the same level have no mutual dependencies — safe to process in parallel.
 *  Files in cycles are returned as a final group (no cross-cycle propagation). */
export function topologicalLevelSort(
  importMap: ReadonlyMap<string, ReadonlySet<string>>,
): readonly IndependentFileGroup[] {
  // Build in-degree map and reverse dependency map
  const inDegree = new Map<string, number>();
  const reverseDeps = new Map<string, string[]>();

  for (const [file, deps] of importMap) {
    if (!inDegree.has(file)) inDegree.set(file, 0);
    for (const dep of deps) {
      if (!inDegree.has(dep)) inDegree.set(dep, 0);
      // file imports dep, so dep must be processed before file
      // In Kahn's terms: dep → file (dep is a prerequisite of file)
      inDegree.set(file, (inDegree.get(file) ?? 0) + 1);
      let rev = reverseDeps.get(dep);
      if (!rev) { rev = []; reverseDeps.set(dep, rev); }
      rev.push(file);
    }
  }

  // BFS from zero-in-degree nodes, grouping by level
  const levels: string[][] = [];
  let currentLevel = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([f]) => f);

  while (currentLevel.length > 0) {
    levels.push(currentLevel);
    const nextLevel: string[] = [];
    for (const file of currentLevel) {
      for (const dependent of reverseDeps.get(file) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) nextLevel.push(dependent);
      }
    }
    currentLevel = nextLevel;
  }

  // Files still with positive in-degree are in cycles — add as final group
  const cycleFiles = [...inDegree.entries()]
    .filter(([, d]) => d > 0)
    .map(([f]) => f);
  if (cycleFiles.length > 0) {
    levels.push(cycleFiles);
  }

  return levels;
}

/** Cycle decomposition from Tarjan's SCC algorithm. */
export interface ImportCycleInfo {
  /** Strongly connected components, each containing ≥2 files */
  sccs: readonly (readonly string[])[];
  /** Files in cycles (flattened sccs — for backward compat) */
  cycleFiles: readonly string[];
}

interface TarjanFrame {
  node: string;
  neighborIdx: number;
  neighbors: readonly string[];
}

/** Decompose cycle files into strongly connected components using iterative Tarjan's.
 *  Runs on the cycle subgraph only (cycle nodes from Kahn's output), not the full graph.
 *  Iterative to avoid stack overflow on large repos (V8 stack limit ~10K-15K frames). */
export function computeImportCycleSCCs(
  importMap: ReadonlyMap<string, ReadonlySet<string>>,
  cycleNodes: readonly string[],
): ImportCycleInfo {
  // Build subgraph of only cycle nodes
  const cycleSet = new Set(cycleNodes);
  const subgraph = new Map<string, readonly string[]>();
  for (const node of cycleNodes) {
    const deps = importMap.get(node);
    subgraph.set(node, deps ? [...deps].filter(d => cycleSet.has(d)) : []);
  }

  // Iterative Tarjan's on subgraph
  const state = new Map<string, { index: number; lowlink: number; onStack: boolean }>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let nextIndex = 0;

  for (const startNode of subgraph.keys()) {
    if (state.has(startNode)) continue;
    const s = { index: nextIndex, lowlink: nextIndex, onStack: true };
    nextIndex++;
    state.set(startNode, s);
    stack.push(startNode);
    const workStack: TarjanFrame[] = [
      { node: startNode, neighborIdx: 0, neighbors: subgraph.get(startNode)! },
    ];

    while (workStack.length > 0) {
      const frame = workStack[workStack.length - 1];
      if (frame.neighborIdx < frame.neighbors.length) {
        const w = frame.neighbors[frame.neighborIdx];
        frame.neighborIdx++;
        const wState = state.get(w);
        if (!wState) {
          const ws = { index: nextIndex, lowlink: nextIndex, onStack: true };
          nextIndex++;
          state.set(w, ws);
          stack.push(w);
          workStack.push({ node: w, neighborIdx: 0, neighbors: subgraph.get(w)! });
        } else if (wState.onStack) {
          state.get(frame.node)!.lowlink = Math.min(
            state.get(frame.node)!.lowlink, wState.index,
          );
        }
      } else {
        workStack.pop();
        const vState = state.get(frame.node)!;
        if (workStack.length > 0) {
          const pState = state.get(workStack[workStack.length - 1].node)!;
          pState.lowlink = Math.min(pState.lowlink, vState.lowlink);
        }
        if (vState.lowlink === vState.index) {
          const component: string[] = [];
          let w: string;
          do { w = stack.pop()!; state.get(w)!.onStack = false; component.push(w); }
          while (w !== frame.node);
          if (component.length >= 2) sccs.push(component);
        }
      }
    }
  }

  return {
    sccs,
    cycleFiles: sccs.flat(),
  };
}

/** Max bytes of source content to load per parse chunk. Each chunk's source +
 *  parsed ASTs + extracted records + worker serialization overhead all live in
 *  memory simultaneously, so this must be conservative. 20MB source ≈ 200-400MB
 *  peak working memory per chunk after parse expansion. */
const CHUNK_BYTE_BUDGET = 20 * 1024 * 1024; // 20MB

/** Max AST trees to keep in LRU cache */
const AST_CACHE_CAP = 50;

/** Threshold for parallel re-resolution within topological levels.
 *  When more files need re-resolution than this threshold, process in parallel via workers.
 *  Set to Infinity to disable (current default — enable when metrics justify). */
const PARALLEL_RE_RESOLUTION_THRESHOLD = Infinity;

export interface PipelineOptions {
  /** Skip MRO, community detection, and process extraction for faster test runs. */
  skipGraphPhases?: boolean;
}

export const runPipelineFromRepo = async (
  repoPath: string,
  onProgress: (progress: PipelineProgress) => void,
  options?: PipelineOptions,
): Promise<PipelineResult> => {
  const graph = createKnowledgeGraph();
  const ctx = createResolutionContext();
  const symbolTable = ctx.symbols;
  let astCache = createASTCache(AST_CACHE_CAP);
  const pipelineStart = Date.now();

  const cleanup = () => {
    astCache.clear();
    ctx.clear();
  };

  try {
    // ── Phase 1: Scan paths only (no content read) ─────────────────────
    onProgress({
      phase: 'extracting',
      percent: 0,
      message: 'Scanning repository...',
    });

    const scannedFiles = await walkRepositoryPaths(repoPath, (current, total, filePath) => {
      const scanProgress = Math.round((current / total) * 15);
      onProgress({
        phase: 'extracting',
        percent: scanProgress,
        message: 'Scanning repository...',
        detail: filePath,
        stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
      });
    });

    const totalFiles = scannedFiles.length;

    onProgress({
      phase: 'extracting',
      percent: 15,
      message: 'Repository scanned successfully',
      stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
    });

    // ── Phase 2: Structure (paths only — no content needed) ────────────
    onProgress({
      phase: 'structure',
      percent: 15,
      message: 'Analyzing project structure...',
      stats: { filesProcessed: 0, totalFiles, nodesCreated: graph.nodeCount },
    });

    const allPaths = scannedFiles.map(f => f.path);
    processStructure(graph, allPaths);

    onProgress({
      phase: 'structure',
      percent: 20,
      message: 'Project structure analyzed',
      stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
    });

    // ── Phase 3+4: Chunked read + parse ────────────────────────────────
    // Group parseable files into byte-budget chunks so only ~20MB of source
    // is in memory at a time. Each chunk is: read → parse → extract → free.

    const parseableScanned = scannedFiles.filter(f => {
      const lang = getLanguageFromFilename(f.path);
      return lang && isLanguageAvailable(lang);
    });

    // Warn about files skipped due to unavailable parsers
    const skippedByLang = new Map<string, number>();
    for (const f of scannedFiles) {
      const lang = getLanguageFromFilename(f.path);
      if (lang && !isLanguageAvailable(lang)) {
        skippedByLang.set(lang, (skippedByLang.get(lang) || 0) + 1);
      }
    }
    for (const [lang, count] of skippedByLang) {
      console.warn(`Skipping ${count} ${lang} file(s) — ${lang} parser not available (native binding may not have built). Try: npm rebuild tree-sitter-${lang}`);
    }

    const totalParseable = parseableScanned.length;

    if (totalParseable === 0) {
      onProgress({
        phase: 'parsing',
        percent: 82,
        message: 'No parseable files found — skipping parsing phase',
        stats: { filesProcessed: 0, totalFiles: 0, nodesCreated: graph.nodeCount },
      });
    }

    // Build byte-budget chunks
    const chunks: string[][] = [];
    let currentChunk: string[] = [];
    let currentBytes = 0;
    for (const file of parseableScanned) {
      if (currentChunk.length > 0 && currentBytes + file.size > CHUNK_BYTE_BUDGET) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = 0;
      }
      currentChunk.push(file.path);
      currentBytes += file.size;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    const numChunks = chunks.length;

    if (isDev) {
      const totalMB = parseableScanned.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
      console.log(`📂 Scan: ${totalFiles} paths, ${totalParseable} parseable (${totalMB.toFixed(0)}MB), ${numChunks} chunks @ ${CHUNK_BYTE_BUDGET / (1024 * 1024)}MB budget`);
    }

    onProgress({
      phase: 'parsing',
      percent: 20,
      message: `Parsing ${totalParseable} files in ${numChunks} chunk${numChunks !== 1 ? 's' : ''}...`,
      stats: { filesProcessed: 0, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
    });

    // Don't spawn workers for tiny repos — overhead exceeds benefit
    const MIN_FILES_FOR_WORKERS = 15;
    const MIN_BYTES_FOR_WORKERS = 512 * 1024;
    const totalBytes = parseableScanned.reduce((s, f) => s + f.size, 0);

    // Create worker pool once, reuse across chunks
    let workerPool: WorkerPool | undefined;
    if (totalParseable >= MIN_FILES_FOR_WORKERS || totalBytes >= MIN_BYTES_FOR_WORKERS) {
      try {
        let workerUrl = new URL('./workers/parse-worker.js', import.meta.url);
        // When running under vitest, import.meta.url points to src/ where no .js exists.
        // Fall back to the compiled dist/ worker so the pool can spawn real worker threads.
        const thisDir = fileURLToPath(new URL('.', import.meta.url));
        if (!fs.existsSync(fileURLToPath(workerUrl))) {
          const distWorker = path.resolve(thisDir, '..', '..', '..', 'dist', 'core', 'ingestion', 'workers', 'parse-worker.js');
          if (fs.existsSync(distWorker)) {
            workerUrl = pathToFileURL(distWorker) as URL;
          }
        }
        workerPool = createWorkerPool(workerUrl);
      } catch (err) {
        if (isDev) console.warn('Worker pool creation failed, using sequential fallback:', (err as Error).message);
      }
    }

    let filesParsedSoFar = 0;

    // AST cache sized for one chunk (sequential fallback uses it for import/call/heritage)
    const maxChunkFiles = chunks.reduce((max, c) => Math.max(max, c.length), 0);
    astCache = createASTCache(maxChunkFiles);

    // Build import resolution context once — suffix index, file lists, resolve cache.
    // Reused across all chunks to avoid rebuilding O(files × path_depth) structures.
    const importCtx = buildImportResolutionContext(allPaths);
    const allPathObjects = allPaths.map(p => ({ path: p }));

    // Single-pass: parse + resolve imports/calls/heritage per chunk.
    // Calls/heritage use the symbol table built so far (symbols from earlier chunks
    // are already registered). This trades ~5% cross-chunk resolution accuracy for
    // 200-400MB less memory — critical for Linux-kernel-scale repos.
    const sequentialChunkPaths: string[][] = [];
    // Phase 14: Collect exported type bindings for cross-file propagation
    const exportedTypeMap: ExportedTypeMap = new Map();

    try {
      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const chunkPaths = chunks[chunkIdx];

        // Read content for this chunk only
        const chunkContents = await readFileContents(repoPath, chunkPaths);
        const chunkFiles = chunkPaths
          .filter(p => chunkContents.has(p))
          .map(p => ({ path: p, content: chunkContents.get(p)! }));

        // Parse this chunk (workers or sequential fallback)
        const chunkWorkerData = await processParsing(
          graph, chunkFiles, symbolTable, astCache,
          (current, _total, filePath) => {
            const globalCurrent = filesParsedSoFar + current;
            const parsingProgress = 20 + ((globalCurrent / totalParseable) * 62);
            onProgress({
              phase: 'parsing',
              percent: Math.round(parsingProgress),
              message: `Parsing chunk ${chunkIdx + 1}/${numChunks}...`,
              detail: filePath,
              stats: { filesProcessed: globalCurrent, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
            });
          },
          workerPool,
        );

        const chunkBasePercent = 20 + ((filesParsedSoFar / totalParseable) * 62);

        if (chunkWorkerData) {
          // Imports
          await processImportsFromExtracted(graph, allPathObjects, chunkWorkerData.imports, ctx, (current, total) => {
            onProgress({
              phase: 'parsing',
              percent: Math.round(chunkBasePercent),
              message: `Resolving imports (chunk ${chunkIdx + 1}/${numChunks})...`,
              detail: `${current}/${total} files`,
              stats: { filesProcessed: filesParsedSoFar, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
            });
          }, repoPath, importCtx);
          // Phase 14 E1: Seed cross-file receiver types from ExportedTypeMap
          // before call resolution — eliminates re-parse for single-hop imported receivers.
          if (exportedTypeMap.size > 0 && ctx.namedImportMap.size > 0) {
            const { enrichedCount } = seedCrossFileReceiverTypes(
              chunkWorkerData.calls, ctx.namedImportMap, exportedTypeMap,
            );
            if (isDev && enrichedCount > 0) {
              console.log(`🔗 E1: Seeded ${enrichedCount} cross-file receiver types (chunk ${chunkIdx + 1})`);
            }
          }
          // Calls + Heritage + Routes — resolve in parallel (no shared mutable state between them)
          // This is safe because each writes disjoint relationship types into idempotent id-keyed Maps,
          // and the single-threaded event loop prevents races between synchronous addRelationship calls.
          await Promise.all([
            processCallsFromExtracted(
              graph,
              chunkWorkerData.calls,
              ctx,
              (current, total) => {
                onProgress({
                  phase: 'parsing',
                  percent: Math.round(chunkBasePercent),
                  message: `Resolving calls (chunk ${chunkIdx + 1}/${numChunks})...`,
                  detail: `${current}/${total} files`,
                  stats: { filesProcessed: filesParsedSoFar, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
                });
              },
              chunkWorkerData.constructorBindings,
              exportedTypeMap,
            ),
            processHeritageFromExtracted(
              graph,
              chunkWorkerData.heritage,
              ctx,
              (current, total) => {
                onProgress({
                  phase: 'parsing',
                  percent: Math.round(chunkBasePercent),
                  message: `Resolving heritage (chunk ${chunkIdx + 1}/${numChunks})...`,
                  detail: `${current}/${total} records`,
                  stats: { filesProcessed: filesParsedSoFar, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
                });
              },
            ),
            processRoutesFromExtracted(
              graph,
              chunkWorkerData.routes ?? [],
              ctx,
              (current, total) => {
                onProgress({
                  phase: 'parsing',
                  percent: Math.round(chunkBasePercent),
                  message: `Resolving routes (chunk ${chunkIdx + 1}/${numChunks})...`,
                  detail: `${current}/${total} routes`,
                  stats: { filesProcessed: filesParsedSoFar, totalFiles: totalParseable, nodesCreated: graph.nodeCount },
                });
              },
            ),
          ]);
          // Process field write assignments (synchronous, runs after calls resolve)
          if (chunkWorkerData.assignments?.length) {
            processAssignmentsFromExtracted(graph, chunkWorkerData.assignments, ctx, chunkWorkerData.constructorBindings);
          }
        } else {
          await processImports(graph, chunkFiles, astCache, ctx, undefined, repoPath, allPaths);
          sequentialChunkPaths.push(chunkPaths);
        }

        filesParsedSoFar += chunkFiles.length;

        // Clear AST cache between chunks to free memory
        astCache.clear();
        // chunkContents + chunkFiles + chunkWorkerData go out of scope → GC reclaims
      }
    } finally {
      await workerPool?.terminate();
    }

    // Sequential fallback chunks: re-read source for call/heritage resolution
    for (const chunkPaths of sequentialChunkPaths) {
      const chunkContents = await readFileContents(repoPath, chunkPaths);
      const chunkFiles = chunkPaths
        .filter(p => chunkContents.has(p))
        .map(p => ({ path: p, content: chunkContents.get(p)! }));
      astCache = createASTCache(chunkFiles.length);
      const rubyHeritage = await processCalls(graph, chunkFiles, astCache, ctx, undefined, exportedTypeMap);
      await processHeritage(graph, chunkFiles, astCache, ctx);
      if (rubyHeritage.length > 0) {
        await processHeritageFromExtracted(graph, rubyHeritage, ctx);
      }
      astCache.clear();
    }

    // Log resolution cache stats
    if (isDev) {
      const rcStats = ctx.getStats();
      const total = rcStats.cacheHits + rcStats.cacheMisses;
      const hitRate = total > 0 ? ((rcStats.cacheHits / total) * 100).toFixed(1) : '0';
      console.log(`🔍 Resolution cache: ${rcStats.cacheHits} hits, ${rcStats.cacheMisses} misses (${hitRate}% hit rate)`);
    }

    // ── Phase 14: Cross-file binding propagation ──────────────────────
    // Seed downstream files with resolved type bindings from upstream files.
    // Uses namedImportMap (populated during import processing) to determine
    // which exported bindings each file needs. Files processed in topological
    // import order so upstream bindings are available when downstream runs.

    // For the worker path, buildTypeEnv runs inside workers without SymbolTable,
    // so exported bindings must be collected from graph + SymbolTable in main thread.
    if (exportedTypeMap.size === 0 && graph.nodeCount > 0) {
      const graphExports = buildExportedTypeMapFromGraph(graph, ctx.symbols);
      for (const [fp, exports] of graphExports) exportedTypeMap.set(fp, exports);
    }

    if (exportedTypeMap.size > 0 && ctx.namedImportMap.size > 0) {
      const allPathSet = new Set(allPaths);
      const levels = topologicalLevelSort(ctx.importMap);

      // E2: SCC diagnostics for import cycles (dev-mode only)
      if (isDev && levels.length > 0) {
        const lastLevel = levels[levels.length - 1];
        // Kahn's dumps cycle files in the last level — detect via positive in-degree check
        // If there are cycle files, decompose into SCCs for diagnostics
        if (lastLevel.length > 1) {
          const cycleInfo = computeImportCycleSCCs(ctx.importMap, lastLevel);
          if (cycleInfo.sccs.length > 0) {
            console.log(`🔄 Detected ${cycleInfo.sccs.length} import cycle(s) (${cycleInfo.cycleFiles.length} files):`);
            for (const scc of cycleInfo.sccs.slice(0, 5)) {
              console.log(`   Cycle (${scc.length} files): ${scc.slice(0, 3).join(', ')}${scc.length > 3 ? '...' : ''}`);
            }
            if (cycleInfo.sccs.length > 5) {
              console.log(`   ... and ${cycleInfo.sccs.length - 5} more cycle(s)`);
            }
          }
        }
      }

      // Count files that would benefit from cross-file seeding
      let filesWithGaps = 0;
      for (const level of levels) {
        for (const filePath of level) {
          const imports = ctx.namedImportMap.get(filePath);
          if (!imports) continue;
          let hasGap = false;
          for (const [, binding] of imports) {
            // E1/E2: upstream file has variable bindings in exportedTypeMap
            if (exportedTypeMap.has(binding.sourcePath)) { hasGap = true; break; }
            // E3: upstream callable has a known return type in SymbolTable
            const def = ctx.symbols.lookupExactFull(binding.sourcePath, binding.exportedName);
            if (def?.returnType) { hasGap = true; break; }
          }
          if (hasGap) filesWithGaps++;
        }
      }

      const CROSS_FILE_SKIP_THRESHOLD = 0.03;
      const gapRatio = totalFiles > 0 ? filesWithGaps / totalFiles : 0;

      if (gapRatio < CROSS_FILE_SKIP_THRESHOLD) {
        if (isDev) {
          console.log(`⏭️ Cross-file re-resolution skipped (${filesWithGaps}/${totalFiles} files, ${(gapRatio * 100).toFixed(1)}% < ${CROSS_FILE_SKIP_THRESHOLD * 100}% threshold)`);
        }
      } else {
        onProgress({
          phase: 'parsing',
          percent: 82,
          message: `Cross-file type propagation (${filesWithGaps} files)...`,
          stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
        });

        let crossFileResolved = 0;
        const crossFileStart = Date.now();
        const MAX_CROSS_FILE_REPROCESS = 2000;
        astCache = createASTCache(AST_CACHE_CAP);

        // ── Worker parallelization design (Phase 14 E4, deferred) ──────────
        // Files within the same topological level have no mutual dependencies
        // and could be processed in parallel. When PARALLEL_RE_RESOLUTION_THRESHOLD
        // is set below Infinity, partition level candidates into worker batches:
        //   1. Serialize ExportedTypeMap snapshot + per-file seeded bindings
        //   2. Ship to workers via structured clone (Map<string, Map<string, string>> serializes efficiently)
        //   3. Workers return updated exports → merge into ExportedTypeMap before next level
        // Gating: implement when re-resolution pass exceeds 20% of total ingestion time.
        for (const level of levels) {
          // Batch: collect files needing re-resolution in this level, then read all at once
          const levelCandidates: { filePath: string; seeded: Map<string, string>; importedReturns: ReadonlyMap<string, string> }[] = [];
          for (const filePath of level) {
            if (crossFileResolved + levelCandidates.length >= MAX_CROSS_FILE_REPROCESS) break;
            const imports = ctx.namedImportMap.get(filePath);
            if (!imports) continue;

            // Build seeded bindings from upstream ExportedTypeMap
            const seeded = new Map<string, string>();
            for (const [localName, binding] of imports) {
              const upstream = exportedTypeMap.get(binding.sourcePath);
              if (upstream) {
                const type = upstream.get(binding.exportedName);
                if (type) seeded.set(localName, type);
              }
            }

            // E3: Build cross-file return types for imported callables
            const importedReturns = buildImportedReturnTypes(filePath, ctx.namedImportMap, ctx.symbols);

            // Skip if neither variable bindings nor callable return types are available
            if (seeded.size === 0 && importedReturns.size === 0) continue;

            // Validate path before re-reading (defense-in-depth)
            if (!allPathSet.has(filePath)) continue;

            const lang = getLanguageFromFilename(filePath);
            if (!lang || !isLanguageAvailable(lang)) continue;

            levelCandidates.push({ filePath, seeded, importedReturns });
          }

          if (levelCandidates.length === 0) continue;

          // Batch read all files in this level at once (avoids per-file I/O overhead)
          const levelPaths = levelCandidates.map(c => c.filePath);
          const contentMap = await readFileContents(repoPath, levelPaths);

          for (const { filePath, seeded, importedReturns } of levelCandidates) {
            const content = contentMap.get(filePath);
            if (!content) continue;

            // Re-parse and re-resolve calls with cross-file seeded type environment
            // Reuse the level-scoped AST cache (LRU eviction handles capacity)
            const reFile = [{ path: filePath, content }];
            const bindings = new Map<string, ReadonlyMap<string, string>>();
            if (seeded.size > 0) bindings.set(filePath, seeded);

            const importedReturnTypesMap = new Map<string, ReadonlyMap<string, string>>();
            if (importedReturns.size > 0) {
              importedReturnTypesMap.set(filePath, importedReturns);
            }

            await processCalls(graph, reFile, astCache, ctx, undefined, exportedTypeMap, bindings.size > 0 ? bindings : undefined, importedReturnTypesMap.size > 0 ? importedReturnTypesMap : undefined);

            crossFileResolved++;
          }

          if (crossFileResolved >= MAX_CROSS_FILE_REPROCESS) {
            if (isDev) console.log(`⚠️ Cross-file re-resolution capped at ${MAX_CROSS_FILE_REPROCESS} files`);
            break;
          }
        }
        // Clear AST cache after re-resolution pass completes
        astCache.clear();

        if (isDev) {
          const elapsed = Date.now() - crossFileStart;
          const totalElapsed = Date.now() - pipelineStart;
          const reResolutionPct = totalElapsed > 0 ? ((elapsed / totalElapsed) * 100).toFixed(1) : '0';
          console.log(
            `🔗 Cross-file re-resolution: ${crossFileResolved}/${filesWithGaps} candidates re-processed` +
            ` in ${elapsed}ms (${reResolutionPct}% of total ingestion time so far)`,
          );
        }
      }
    }

    // Free import resolution context — suffix index + resolve cache no longer needed
    // (allPathObjects and importCtx hold ~94MB+ for large repos)
    allPathObjects.length = 0;
    importCtx.resolveCache.clear();
    (importCtx as any).suffixIndex = null;
    (importCtx as any).normalizedFileList = null;

    let communityResult: Awaited<ReturnType<typeof processCommunities>> | undefined;
    let processResult: Awaited<ReturnType<typeof processProcesses>> | undefined;

    if (!options?.skipGraphPhases) {
      // ── Phase 4.5: Method Resolution Order ──────────────────────────────
      onProgress({
        phase: 'parsing',
        percent: 81,
        message: 'Computing method resolution order...',
        stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
      });

      const mroResult = computeMRO(graph);
      if (isDev && mroResult.entries.length > 0) {
        console.log(`🔀 MRO: ${mroResult.entries.length} classes analyzed, ${mroResult.ambiguityCount} ambiguities found, ${mroResult.overrideEdges} OVERRIDES edges`);
      }

      // ── Phase 5: Communities ───────────────────────────────────────────
      onProgress({
        phase: 'communities',
        percent: 82,
        message: 'Detecting code communities...',
        stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
      });

      communityResult = await processCommunities(graph, (message, progress) => {
        const communityProgress = 82 + (progress * 0.10);
        onProgress({
          phase: 'communities',
          percent: Math.round(communityProgress),
          message,
          stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
        });
      });

      if (isDev) {
        console.log(`🏘️ Community detection: ${communityResult.stats.totalCommunities} communities found (modularity: ${communityResult.stats.modularity.toFixed(3)})`);
      }

      communityResult.communities.forEach(comm => {
        graph.addNode({
          id: comm.id,
          label: 'Community' as const,
          properties: {
            name: comm.label,
            filePath: '',
            heuristicLabel: comm.heuristicLabel,
            cohesion: comm.cohesion,
            symbolCount: comm.symbolCount,
          }
        });
      });

      communityResult.memberships.forEach(membership => {
        graph.addRelationship({
          id: `${membership.nodeId}_member_of_${membership.communityId}`,
          type: 'MEMBER_OF',
          sourceId: membership.nodeId,
          targetId: membership.communityId,
          confidence: 1.0,
          reason: 'leiden-algorithm',
        });
      });

      // ── Phase 6: Processes ─────────────────────────────────────────────
      onProgress({
        phase: 'processes',
        percent: 94,
        message: 'Detecting execution flows...',
        stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
      });

      let symbolCount = 0;
      graph.forEachNode(n => { if (n.label !== 'File') symbolCount++; });
      const dynamicMaxProcesses = Math.max(20, Math.min(300, Math.round(symbolCount / 10)));

      processResult = await processProcesses(
        graph,
        communityResult.memberships,
        (message, progress) => {
          const processProgress = 94 + (progress * 0.05);
          onProgress({
            phase: 'processes',
            percent: Math.round(processProgress),
            message,
            stats: { filesProcessed: totalFiles, totalFiles, nodesCreated: graph.nodeCount },
          });
        },
        { maxProcesses: dynamicMaxProcesses, minSteps: 3 }
      );

      if (isDev) {
        console.log(`🔄 Process detection: ${processResult.stats.totalProcesses} processes found (${processResult.stats.crossCommunityCount} cross-community)`);
      }

      processResult.processes.forEach(proc => {
        graph.addNode({
          id: proc.id,
          label: 'Process' as const,
          properties: {
            name: proc.label,
            filePath: '',
            heuristicLabel: proc.heuristicLabel,
            processType: proc.processType,
            stepCount: proc.stepCount,
            communities: proc.communities,
            entryPointId: proc.entryPointId,
            terminalId: proc.terminalId,
          }
        });
      });

      processResult.steps.forEach(step => {
        graph.addRelationship({
          id: `${step.nodeId}_step_${step.step}_${step.processId}`,
          type: 'STEP_IN_PROCESS',
          sourceId: step.nodeId,
          targetId: step.processId,
          confidence: 1.0,
          reason: 'trace-detection',
          step: step.step,
        });
      });
    }

    onProgress({
      phase: 'complete',
      percent: 100,
      message: communityResult && processResult
        ? `Graph complete! ${communityResult.stats.totalCommunities} communities, ${processResult.stats.totalProcesses} processes detected.`
        : 'Graph complete! (graph phases skipped)',
      stats: {
        filesProcessed: totalFiles,
        totalFiles,
        nodesCreated: graph.nodeCount
      },
    });

    astCache.clear();

    return { graph, repoPath, totalFileCount: totalFiles, communityResult, processResult };
  } catch (error) {
    cleanup();
    throw error;
  }
};
