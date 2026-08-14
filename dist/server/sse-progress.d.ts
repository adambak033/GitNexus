/**
 * SSE progress relay for JobManager-backed jobs (`/api/analyze` and `/api/embed`).
 *
 * Extracted from api.ts so the relay can be driven by a test without booting
 * Express + the LadybugDB native adapter + the whole MCP wiring: the bug this
 * module exists to prevent is only observable END TO END (a client watching the
 * stream), and a contract that can only be checked by regex over api.ts's source
 * is not a contract. Nothing here imports the database or MCP; `express` is a
 * TYPE-only import, so the runtime cost of loading this module is validation.ts
 * plus analyze-job.ts. Import it from HERE — routing through api.ts re-imports
 * everything the extraction was meant to avoid.
 */
import type express from 'express';
import { type JobManager } from './analyze-job.js';
/**
 * Mount an SSE progress endpoint for a JobManager.
 * Handles: initial state, terminal events, heartbeat, event IDs, client disconnect.
 *
 * Terminal payloads carry `repoPath` (the analyzed path) alongside the display
 * `repoName` so clients can reconnect by path identity — with duplicate
 * basenames, a name-only reconnect resolves to the first same-named sibling.
 * Exported for unit tests that lock the wire payload shape.
 *
 * ── The stream closes on the JOB'S STATUS, never on a phase string (#2790) ──
 * This used to end the response as soon as a progress event carried
 * `phase: 'complete'` or `'failed'`. /api/embed maps the pipeline's `ready`
 * phase, which `runEmbeddingPipeline` emits UNCONDITIONALLY — including when it
 * dropped nodes to endpoint failures — and the route only decides the real
 * outcome after the pipeline returns. So the relay wrote `event: complete` with
 * `error: undefined`, called `res.end()` and unsubscribed; the route's later
 * `updateJob({status:'failed'})` was emitted into a stream nobody was listening
 * to. An SSE client saw a tolerated partial run as a clean success while a
 * `GET /api/embed/:jobId` poller saw `failed` — the two consumers of one job
 * disagreeing about whether the data is complete.
 *
 * `updateJob` already synthesizes exactly one terminal progress event (and
 * refuses every update once the job is terminal, #2264 P3), and it assigns the
 * status BEFORE emitting — so asking the job is both sufficient and the only
 * source that cannot be spoofed by an intermediate phase label.
 */
export declare const mountSSEProgress: (app: express.Express, routePath: string, jm: JobManager) => void;
