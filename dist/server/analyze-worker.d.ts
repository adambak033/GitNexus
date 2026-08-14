/**
 * Analyze Worker — Forked Child Process
 *
 * This file is the entry point for `child_process.fork()`.
 * It runs runFullAnalysis in an isolated process with 8GB heap.
 *
 * IPC Protocol:
 *   Parent -> Child: { type: 'start', repoPath: string, options: AnalyzeOptions }
 *   Child -> Parent: { type: 'progress', phase: string, percent: number, message: string }
 *   Child -> Parent: { type: 'complete', result: AnalyzeResult }
 *   Child -> Parent: { type: 'error', message: string }
 */
export type { CompleteMessage, WorkerMessage } from './analyze-worker-protocol.js';
