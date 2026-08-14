/**
 * Cross-repo call trace.
 *
 * Stitches per-repo directed-path segments (CALLS + HAS_METHOD, via the
 * existing single-repo `trace`) across a single `ContractLink` boundary in the
 * group bridge, and — when a `--pdg` layer is present and the caller opts in —
 * enriches the boundary-adjacent segments with their intra-procedural
 * REACHING_DEF data-flow.
 *
 * Design notes:
 *  - The crossing is a single bridge hop joined on `symbolUid` (the symbol node
 *    id is the same value the bridge stores as `Contract.symbolUid`). This
 *    mirrors `cross-impact.ts` and is clamped to one boundary
 *    (`MAX_SUPPORTED_CROSS_DEPTH`); multi-hop is deferred.
 *  - All trace-specific bridge Cypher lives in THIS module (mirroring the
 *    "all bridge Cypher for this feature lives here" convention in
 *    cross-impact.ts). The trace needs BOTH endpoints of a crossing to stitch a
 *    path, so it issues its own pair query rather than the lossy uid-filtered
 *    neighbor join exported by cross-impact (`resolveBridgeNeighbors`), which
 *    intentionally returns only the far side.
 *  - PDG is enrichment only: data flow never crosses the repo boundary. Full
 *    cross-program (SDG-like) data flow is deferred — see
 *    docs/plans/2026-06-18-002-feat-unified-pdg-impact-evaluation-plan.md.
 */
import { GroupNotFoundError, loadGroupConfig } from './config-parser.js';
import { getGroupDir } from './storage.js';
import { ensureBridgeReady, MAX_SUPPORTED_CROSS_DEPTH } from './cross-impact.js';
import { compareCodeUnits } from '../../lib/utils.js';
import { closeBridgeDb, queryBridge } from './bridge-db.js';
/**
 * Centralized degraded-state messages so wording stays consistent and
 * testable. Kept as named constants/builders rather than inline strings.
 */
export const TRACE_NOTES = {
    noBridgeLink: 'No ContractLink connects the two endpoints across repos — the call chain ' +
        'likely crosses a boundary the group bridge has not linked. Run group_sync, ' +
        'or check that both sides of the contract were extracted.',
    crossDepthClamped: `Multi-hop cross-boundary trace is not implemented yet; using a single ` +
        `boundary crossing (crossDepth ${MAX_SUPPORTED_CROSS_DEPTH}).`,
    noLocalPath: (repo) => `No directed CALLS/HAS_METHOD path within ${repo} for the resolved endpoints.`,
    noPdgLayer: (repo) => `No PDG layer in ${repo}; call-level hops only.`,
    pdgRequested: 'PDG enrichment was requested (experimental). Data-flow hops are intra-procedural ' +
        'and never cross the repo boundary.',
    pdgSameRepoNoop: 'pdg:true has no effect for a same-repo trace — PDG data-flow enrichment only runs ' +
        'at a cross-repo ContractLink boundary.',
    crossingsCapped: (cap) => `More than ${cap} ContractLinks connect these repos; only the ${cap} highest-confidence ` +
        `crossings were tried. Narrow with from_uid/to_uid if the expected path was missed.`,
    degradedMembers: (repos) => `${repos.length} member repo(s) could not be queried (${repos.join(', ')}) — a not_found ` +
        `result may be incomplete; re-run once the repo(s) are indexed and available.`,
    fileBoundaryFallback: 'A cross-repo boundary was anchored by contract FILE, not symbol — the HTTP (or other ' +
        'source-scan) contract carried no resolved symbolUid, so the endpoint was matched because ' +
        'it lives in the contract file. The boundary is file-level, not symbol-precise.',
    anonymousHandler: (route, location) => `The handler for ${route} is anonymous (no named symbol); reported by location ${location}. ` +
        `Pass a named function the handler calls as 'to' to trace deeper into the provider.`,
    destinationNoLink: 'No outgoing HTTP ContractLink leaves this repo for any provider — the symbol may make no ' +
        'cross-repo HTTP call, or group_sync has not linked it. Pass a `to` for a symbol-to-symbol trace.',
    destinationNoReach: 'An HTTP ContractLink leaves this repo, but `from` does not reach its consumer call site. ' +
        'Trace from the function that actually issues the request.',
    destinationMultiple: '`from` reaches more than one HTTP endpoint — the destination is ambiguous. The candidates ' +
        'are listed; pass `to`/`to_uid` to pick one, or trace from the exact calling function.',
    destinationAmbiguousFile: '`from`’s file makes more than one HTTP call and those consumer contracts carry no resolved ' +
        'symbolUid, so the specific destination cannot be determined (file-level, not symbol-precise). ' +
        'The candidates are listed; trace from the exact calling function or pass `to_uid`.',
};
/** Repo-relative path equality, tolerant of a leading "./" / "/" or a repo prefix. */
function sameFile(a, b) {
    if (!a || !b)
        return false;
    const norm = (s) => s.replace(/^\.?\//, '');
    const na = norm(a);
    const nb = norm(b);
    return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}
function asLocalTrace(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    if (typeof o.status !== 'string')
        return null;
    // Project the known fields (all optional but `status`) instead of a blanket
    // `as unknown as` cast. The per-field `unknown -> T` assertions trust the
    // single-repo `trace` port contract for the array element shapes.
    return {
        status: o.status,
        from: o.from,
        to: o.to,
        hopCount: typeof o.hopCount === 'number' ? o.hopCount : undefined,
        hops: Array.isArray(o.hops) ? o.hops : undefined,
        edges: Array.isArray(o.edges) ? o.edges : undefined,
    };
}
// ── Bridge pair query (trace-specific; keeps BOTH endpoints) ──────────────
/**
 * Cap on ContractLinks attempted between one repo pair. Each crossing can cost
 * up to two trace BFS queries, so an unbounded `bridge.lbug` (a repo pair that
 * shares many contracts) would otherwise drive an unbounded fan-out. Crossings
 * are confidence-sorted, so the cap keeps the strongest candidates; exceeding it
 * is surfaced via a note (no silent truncation). Generous because the per-unique
 * endpoint memoization in `stitchCrossRepo` already collapses most of the cost.
 */
const MAX_CROSSINGS_TO_TRY = 50;
// ORDER BY + LIMIT in the query so the cap keeps the highest-confidence
// crossings (LadybugDB has no rel-property index; this is the bound). One extra
// row (`+ 1`) lets the caller detect — and surface — truncation.
const CY_CROSSINGS_BETWEEN = `
MATCH (consumer:Contract)-[l:ContractLink]->(provider:Contract)
WHERE consumer.repo = $fromRepo
  AND provider.repo = $toRepo
  AND consumer.role = 'consumer'
  AND provider.role = 'provider'
RETURN consumer.symbolUid AS consumerUid,
       provider.symbolUid AS providerUid,
       consumer.filePath AS consumerFile,
       provider.filePath AS providerFile,
       l.matchType AS matchType,
       l.confidence AS confidence,
       l.contractId AS contractId,
       consumer.type AS contractType
ORDER BY l.confidence DESC, contractId, consumerUid, providerUid
LIMIT ${MAX_CROSSINGS_TO_TRY + 1}
`;
// Destination trace: every ContractLink leaving a consumer repo, to ANY provider
// repo. Returns the provider's repo + symbol name so the endpoint can be reported
// even when it has no resolved symbolUid (an anonymous handler).
const CY_CROSSINGS_FROM = `
MATCH (consumer:Contract)-[l:ContractLink]->(provider:Contract)
WHERE consumer.repo = $fromRepo
  AND consumer.role = 'consumer'
  AND provider.role = 'provider'
RETURN consumer.symbolUid AS consumerUid,
       provider.symbolUid AS providerUid,
       consumer.filePath AS consumerFile,
       provider.filePath AS providerFile,
       provider.repo AS providerRepo,
       provider.symbolName AS providerName,
       l.matchType AS matchType,
       l.confidence AS confidence,
       l.contractId AS contractId,
       consumer.type AS contractType
ORDER BY l.confidence DESC, contractId, consumerUid, providerUid
LIMIT ${MAX_CROSSINGS_TO_TRY + 1}
`;
function rowToCrossing(r) {
    const consumerFile = String(r.consumerFile ?? r[2] ?? '');
    const providerFile = String(r.providerFile ?? r[3] ?? '');
    // A crossing is usable if EITHER endpoint can be anchored — by a resolved
    // symbolUid (gRPC/manifest/named) OR, when the uid is empty (HTTP and other
    // source-scan contracts hardcode symbolUid:''), by the contract's file so the
    // file-level boundary fallback in stitchCrossRepo can still connect it. Drop
    // only crossings that have neither a uid nor a file on a side.
    const consumerUid = String(r.consumerUid ?? r[0] ?? '');
    const providerUid = String(r.providerUid ?? r[1] ?? '');
    if (!consumerUid && !consumerFile)
        return null;
    if (!providerUid && !providerFile)
        return null;
    return {
        consumerUid,
        providerUid,
        consumerFile,
        providerFile,
        matchType: String(r.matchType ?? r[4] ?? 'exact'),
        confidence: Number(r.confidence ?? r[5] ?? 0),
        contractId: String(r.contractId ?? r[6] ?? ''),
        contractType: String(r.contractType ?? r[7] ?? 'custom'),
    };
}
/**
 * Sort a crossing list on the full crossing identity, then apply
 * `MAX_CROSSINGS_TO_TRY`.
 *
 * Both bridge queries already order by confidence DESC; this re-sorts
 * defensively so the cap keeps the strongest candidates even if a tuple-mode
 * driver reorders rows. The comparator mirrors BOTH queries' `ORDER BY`
 * key-for-key — a shorter comparator reproduces less than the order it is
 * defending, leaving ties on raw row order (#2787) — so it lives in one place
 * rather than being hand-synced across the two callers and two Cypher clauses.
 */
function capCrossings(all) {
    all.sort((a, b) => b.confidence - a.confidence ||
        compareCodeUnits(a.contractId, b.contractId) ||
        compareCodeUnits(a.consumerUid, b.consumerUid) ||
        compareCodeUnits(a.providerUid, b.providerUid));
    const truncated = all.length > MAX_CROSSINGS_TO_TRY;
    return {
        crossings: truncated ? all.slice(0, MAX_CROSSINGS_TO_TRY) : all,
        truncated,
    };
}
async function listCrossingsBetween(handle, fromRepo, toRepo) {
    const rows = await queryBridge(handle, CY_CROSSINGS_BETWEEN, {
        fromRepo,
        toRepo,
    });
    const all = [];
    for (const raw of rows) {
        const c = rowToCrossing(raw);
        if (c)
            all.push(c);
    }
    return capCrossings(all);
}
function destRowToCrossing(r) {
    const consumerUid = String(r.consumerUid ?? r[0] ?? '');
    const consumerFile = String(r.consumerFile ?? r[2] ?? '');
    // Only the consumer side must be anchorable here — the provider endpoint is
    // reported (by name/file), not traced into, so an empty provider uid is fine.
    if (!consumerUid && !consumerFile)
        return null;
    return {
        consumerUid,
        providerUid: String(r.providerUid ?? r[1] ?? ''),
        consumerFile,
        providerFile: String(r.providerFile ?? r[3] ?? ''),
        providerRepo: String(r.providerRepo ?? r[4] ?? ''),
        providerName: String(r.providerName ?? r[5] ?? ''),
        matchType: String(r.matchType ?? r[6] ?? 'exact'),
        confidence: Number(r.confidence ?? r[7] ?? 0),
        contractId: String(r.contractId ?? r[8] ?? ''),
        contractType: String(r.contractType ?? r[9] ?? 'custom'),
    };
}
async function listCrossingsFrom(handle, fromRepo) {
    const rows = await queryBridge(handle, CY_CROSSINGS_FROM, { fromRepo });
    const all = [];
    for (const raw of rows) {
        const c = destRowToCrossing(raw);
        if (c)
            all.push(c);
    }
    return capCrossings(all);
}
/**
 * Resolve a symbol query across every member repo. Exactly one `ok` match and
 * no per-member ambiguity → resolved. Zero matches → not_found. Anything else
 * (multiple members match, or any member is itself ambiguous) → ambiguous, with
 * every candidate tagged by its repo so the caller can disambiguate.
 */
async function resolveAcrossMembers(port, members, query) {
    const okMatches = [];
    const ambiguous = [];
    const degraded = [];
    // Resolve the symbol in every member concurrently (each is an independent DB
    // read). Promise.all preserves member order, so the aggregated okMatches /
    // ambiguous sets are identical to a sequential walk — matching how
    // groupContext / groupQuery iterate members.
    const resolveSymbol = port.resolveSymbol;
    const perMember = await Promise.all(members.map(async (member) => {
        if (!resolveSymbol)
            return null;
        try {
            return { member, outcome: await resolveSymbol(member.handle, query) };
        }
        catch {
            // A throw means the member's DB could not be queried — NOT that the
            // symbol is absent. Record it so a not_found can be flagged as
            // possibly-incomplete rather than asserting the symbol does not exist.
            return { member, failed: true };
        }
    }));
    for (const entry of perMember) {
        if (!entry)
            continue;
        if ('failed' in entry) {
            degraded.push(entry.member.repoPath);
            continue;
        }
        const { member, outcome } = entry;
        if (outcome.kind === 'ok') {
            okMatches.push({
                member,
                symbol: {
                    id: outcome.symbol.id,
                    name: outcome.symbol.name,
                    filePath: outcome.symbol.filePath,
                    startLine: outcome.symbol.startLine,
                },
            });
        }
        else if (outcome.kind === 'ambiguous') {
            for (const c of outcome.candidates) {
                ambiguous.push({
                    repo: member.repoPath,
                    id: c.id,
                    name: c.name,
                    filePath: c.filePath,
                    startLine: c.startLine,
                });
            }
        }
    }
    if (okMatches.length === 1 && ambiguous.length === 0) {
        return { outcome: { kind: 'ok', endpoint: okMatches[0] }, degraded };
    }
    if (okMatches.length === 0 && ambiguous.length === 0) {
        return { outcome: { kind: 'not_found' }, degraded };
    }
    // Multiple repos matched, or a member was internally ambiguous: surface all.
    const candidates = [
        ...okMatches.map((m) => ({
            repo: m.member.repoPath,
            id: m.symbol.id,
            name: m.symbol.name,
            filePath: m.symbol.filePath,
            startLine: m.symbol.startLine,
        })),
        ...ambiguous,
    ];
    return { outcome: { kind: 'ambiguous', candidates }, degraded };
}
// ── Stitching ────────────────────────────────────────────────────────────
function tagHops(hops, repo) {
    return (hops ?? []).map((h) => ({
        name: h.name,
        filePath: h.filePath,
        startLine: h.startLine,
        repo,
    }));
}
function endpointFrom(res) {
    return {
        name: res.symbol.name,
        filePath: res.symbol.filePath,
        startLine: res.symbol.startLine,
        repo: res.member.repoPath,
    };
}
// ── PDG enrichment (U4 hook) ─────────────────────────────────────────────
/**
 * Attach the intra-procedural REACHING_DEF data-flow for a boundary-adjacent
 * segment, when the caller opted in (`pdg:true`) and the repo has a PDG `flows`
 * layer. Returns `undefined` (no enrichment) plus a note when degraded.
 */
async function enrichSegment(port, member, anchorUid, anchorName, limit, notes) {
    const pdgFlows = port.pdgFlows;
    if (!pdgFlows)
        return undefined;
    let flow;
    try {
        flow = await pdgFlows(member.handle, { uid: anchorUid }, { limit });
    }
    catch {
        return undefined;
    }
    if (!flow.available) {
        notes.push(TRACE_NOTES.noPdgLayer(member.repoPath));
        return undefined;
    }
    if (flow.hops.length === 0)
        return undefined;
    return {
        repo: member.repoPath,
        anchor: anchorName,
        variable: flow.variable,
        hops: flow.hops,
        truncated: flow.truncated,
    };
}
const DEFAULT_PDG_FLOW_LIMIT = 50;
const MAX_PDG_FLOW_LIMIT = 200;
function str(v) {
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
function parseTraceParams(params) {
    const name = String(params.name ?? '').trim();
    if (!name)
        return { ok: false, error: 'name is required' };
    const from = str(params.from);
    const to = str(params.to);
    const from_uid = str(params.from_uid);
    const to_uid = str(params.to_uid);
    const to_file = str(params.to_file);
    if (!from && !from_uid)
        return { ok: false, error: 'from (or from_uid) is required' };
    // No `to` at all → destination trace (trace `from` to its HTTP endpoint).
    const destination = !to && !to_uid && !to_file;
    const maxDepth = typeof params.maxDepth === 'number' && params.maxDepth > 0 ? params.maxDepth : undefined;
    const rawLimit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_PDG_FLOW_LIMIT;
    const crossDepthClamped = typeof params.crossDepth === 'number' &&
        Number.isFinite(params.crossDepth) &&
        Math.floor(params.crossDepth) > MAX_SUPPORTED_CROSS_DEPTH;
    return {
        ok: true,
        parsed: {
            name,
            from,
            to,
            from_uid,
            to_uid,
            from_file: str(params.from_file),
            to_file,
            maxDepth,
            includeTests: Boolean(params.includeTests),
            pdg: params.pdg === true,
            pdgLimit: Math.min(rawLimit, MAX_PDG_FLOW_LIMIT),
            crossDepthClamped,
            destination,
        },
    };
}
// ── Main entry ───────────────────────────────────────────────────────────
export async function runGroupTrace(deps, params) {
    const parsedResult = parseTraceParams(params);
    if (parsedResult.ok === false) {
        return {
            status: 'error',
            group: String(params.name ?? ''),
            error: parsedResult.error,
            notes: [],
        };
    }
    const p = parsedResult.parsed;
    if (!deps.port.trace || !deps.port.resolveSymbol) {
        return {
            status: 'error',
            group: p.name,
            error: 'Cross-repo trace is not supported by this backend (trace/resolveSymbol unavailable).',
            notes: [],
        };
    }
    const groupDir = getGroupDir(deps.gitnexusDir, p.name);
    let config;
    try {
        config = await loadGroupConfig(groupDir);
    }
    catch (e) {
        if (e instanceof GroupNotFoundError) {
            return {
                status: 'error',
                group: p.name,
                error: `Group "${p.name}" not found. Run group_list to see configured groups.`,
                notes: [],
            };
        }
        return {
            status: 'error',
            group: p.name,
            error: e instanceof Error ? e.message : String(e),
            notes: [],
        };
    }
    // Resolve member handles up front, concurrently (each opens an independent
    // repo pool; order is preserved by Promise.all). A member that can't be
    // resolved is skipped — its absence only matters if an endpoint lived there,
    // which surfaces downstream as not_found.
    const resolvedMembers = await Promise.all(Object.entries(config.repos).map(async ([repoPath, registryName]) => {
        try {
            const handle = await deps.port.resolveRepo(registryName);
            return { repoPath, registryName, handle };
        }
        catch {
            return { repoPath, failed: true };
        }
    }));
    const members = [];
    const unreachableMembers = [];
    for (const m of resolvedMembers) {
        if ('failed' in m)
            unreachableMembers.push(m.repoPath);
        else
            members.push(m);
    }
    if (members.length === 0) {
        return {
            status: 'error',
            group: p.name,
            error: 'No resolvable repos in this group.',
            notes: [],
        };
    }
    // A not_found is only authoritative if every relevant member was actually
    // queryable. Members whose repo failed to resolve, or whose symbol query
    // threw, are tracked so a not_found can be flagged as possibly-incomplete
    // rather than asserting the symbol does not exist anywhere.
    const degradedNotes = (extra) => {
        const all = [...new Set([...unreachableMembers, ...extra])];
        return all.length > 0 ? [TRACE_NOTES.degradedMembers(all)] : [];
    };
    const fromRes = await resolveAcrossMembers(deps.port, members, {
        name: p.from,
        uid: p.from_uid,
        file_path: p.from_file,
    });
    if (fromRes.outcome.kind === 'not_found') {
        return {
            status: 'not_found',
            group: p.name,
            role: 'from',
            query: p.from_uid ?? p.from,
            notes: degradedNotes(fromRes.degraded),
            suggestion: 'Check the symbol name, pass from_uid for zero-ambiguity, or from_file to narrow.',
        };
    }
    if (fromRes.outcome.kind === 'ambiguous') {
        return {
            status: 'ambiguous',
            group: p.name,
            role: 'from',
            candidates: fromRes.outcome.candidates,
            notes: [],
        };
    }
    const fromEp = fromRes.outcome.endpoint;
    // Destination trace: no `to` was given → follow `from`'s outgoing HTTP call
    // across the bridge and report where it lands. This is the only way to reach
    // a handler that has no nameable symbol (an inline anonymous route handler).
    if (p.destination) {
        return stitchToDestination(deps, p, fromEp, groupDir, degradedNotes(fromRes.degraded));
    }
    const toRes = await resolveAcrossMembers(deps.port, members, {
        name: p.to,
        uid: p.to_uid,
        file_path: p.to_file,
    });
    if (toRes.outcome.kind === 'not_found') {
        return {
            status: 'not_found',
            group: p.name,
            role: 'to',
            query: p.to_uid ?? p.to,
            notes: degradedNotes([...fromRes.degraded, ...toRes.degraded]),
            suggestion: 'Check the symbol name, pass to_uid for zero-ambiguity, or to_file to narrow.',
        };
    }
    if (toRes.outcome.kind === 'ambiguous') {
        return {
            status: 'ambiguous',
            group: p.name,
            role: 'to',
            candidates: toRes.outcome.candidates,
            notes: [],
        };
    }
    const toEp = toRes.outcome.endpoint;
    // Seed with degraded-member notes so a SUCCESSFUL trace is still flagged as
    // possibly-incomplete: group resolution is "unique among the members we could
    // query", so if a member that threw during resolveSymbol also holds `from`/`to`
    // the real answer could be ambiguous. Carries through same-repo and cross-repo
    // success, not just the not_found branches.
    const notes = degradedNotes([...fromRes.degraded, ...toRes.degraded]);
    // Same repo → single-repo trace, no crossing.
    if (fromEp.member.repoPath === toEp.member.repoPath) {
        return stitchSameRepo(deps.port, p, fromEp, toEp, notes);
    }
    // Different repos → cross one ContractLink boundary.
    return stitchCrossRepo(deps, p, fromEp, toEp, groupDir, notes);
}
async function stitchSameRepo(port, p, fromEp, toEp, notes) {
    // PDG enrichment only runs at a cross-repo boundary; tell the agent why a
    // same-repo trace returns no dataFlow even though pdg:true was passed.
    if (p.pdg)
        notes.push(TRACE_NOTES.pdgSameRepoNoop);
    const segRaw = await port.trace(fromEp.member.handle, {
        from_uid: fromEp.symbol.id,
        to_uid: toEp.symbol.id,
        maxDepth: p.maxDepth,
        includeTests: p.includeTests,
    });
    const seg = asLocalTrace(segRaw);
    if (!seg || seg.status !== 'ok') {
        notes.push(TRACE_NOTES.noLocalPath(fromEp.member.repoPath));
        return {
            status: 'not_found',
            group: p.name,
            notes,
            suggestion: 'Both endpoints resolve in the same repo but no directed path connects them. ' +
                'Try a higher maxDepth or inspect connections with context().',
        };
    }
    const hops = tagHops(seg.hops, fromEp.member.repoPath);
    const edges = (seg.edges ?? []).map((e) => ({
        relType: e.relType,
        confidence: e.confidence,
    }));
    return {
        status: 'ok',
        group: p.name,
        from: endpointFrom(fromEp),
        to: endpointFrom(toEp),
        crossings: [],
        hopCount: edges.length,
        hops,
        edges,
        notes,
    };
}
async function stitchCrossRepo(deps, p, fromEp, toEp, groupDir, notes) {
    const bridgePrep = await ensureBridgeReady(groupDir);
    if ('error' in bridgePrep) {
        return { status: 'error', group: p.name, error: bridgePrep.error, notes };
    }
    const handle = bridgePrep.handle;
    if (p.crossDepthClamped)
        notes.push(TRACE_NOTES.crossDepthClamped);
    if (p.pdg)
        notes.push(TRACE_NOTES.pdgRequested);
    try {
        const { crossings, truncated: crossingsTruncated } = await listCrossingsBetween(handle, fromEp.member.repoPath, toEp.member.repoPath);
        if (crossings.length === 0) {
            notes.push(TRACE_NOTES.noBridgeLink);
            return {
                status: 'not_found',
                group: p.name,
                notes,
                suggestion: 'The endpoints live in different repos with no ContractLink between them. ' +
                    'Run group_sync, or trace within a single repo.',
            };
        }
        if (crossingsTruncated)
            notes.push(TRACE_NOTES.crossingsCapped(MAX_CROSSINGS_TO_TRY));
        // Per-endpoint trace memoization: many crossings can share one consumer
        // (a client call linked to several providers) or one provider, and the
        // home-repo segment depends ONLY on the consumer uid (from is fixed) while
        // the target-repo segment depends ONLY on the provider uid (to is fixed).
        // Cache each unique-endpoint trace so the fan-out is bounded by the number
        // of distinct endpoints, not the number of crossings. `undefined` = not yet
        // attempted; `null` = attempted and did not connect.
        const segACache = new Map();
        const segBCache = new Map();
        const traceFromTo = async (handleToUse, fromUid, toUid) => {
            const raw = await deps.port.trace(handleToUse, {
                from_uid: fromUid,
                to_uid: toUid,
                maxDepth: p.maxDepth,
                includeTests: p.includeTests,
            });
            const seg = asLocalTrace(raw);
            return seg && seg.status === 'ok' ? seg : null;
        };
        // Single boundary crossing (MAX_SUPPORTED_CROSS_DEPTH). Try crossings in
        // confidence order; the first one whose two segments both connect wins.
        let usedFileFallback = false;
        for (const crossing of crossings) {
            // Anchor each boundary to a usable symbol id. Prefer the resolved
            // symbolUid; when it is empty (HTTP and other source-scan contracts
            // hardcode symbolUid:''), fall back to the trace endpoint itself when it
            // lives in the contract's file — the common "trace from the calling
            // function to the handler function" case. A side we can anchor on neither
            // a uid nor the file is skipped.
            let consumerUid = crossing.consumerUid;
            let consumerViaFile = false;
            if (!consumerUid && sameFile(fromEp.symbol.filePath, crossing.consumerFile)) {
                consumerUid = fromEp.symbol.id;
                consumerViaFile = true;
            }
            if (!consumerUid)
                continue;
            let providerUid = crossing.providerUid;
            let providerViaFile = false;
            if (!providerUid && sameFile(toEp.symbol.filePath, crossing.providerFile)) {
                providerUid = toEp.symbol.id;
                providerViaFile = true;
            }
            if (!providerUid)
                continue;
            let segA = segACache.get(consumerUid);
            if (segA === undefined) {
                segA = await traceFromTo(fromEp.member.handle, fromEp.symbol.id, consumerUid);
                segACache.set(consumerUid, segA);
            }
            if (!segA)
                continue;
            let segB = segBCache.get(providerUid);
            if (segB === undefined) {
                segB = await traceFromTo(toEp.member.handle, providerUid, toEp.symbol.id);
                segBCache.set(providerUid, segB);
            }
            if (!segB)
                continue;
            usedFileFallback = consumerViaFile || providerViaFile;
            // Found a connecting crossing. Build the stitched path.
            const hopsA = tagHops(segA.hops, fromEp.member.repoPath);
            const hopsB = tagHops(segB.hops, toEp.member.repoPath);
            const edgesA = (segA.edges ?? []).map((e) => ({
                relType: e.relType,
                confidence: e.confidence,
            }));
            const edgesB = (segB.edges ?? []).map((e) => ({
                relType: e.relType,
                confidence: e.confidence,
            }));
            const boundaryEdge = { relType: 'CONTRACT_LINK', confidence: crossing.confidence };
            const bridgeCrossing = {
                fromRepo: fromEp.member.repoPath,
                toRepo: toEp.member.repoPath,
                contractId: crossing.contractId,
                contractType: crossing.contractType,
                matchType: crossing.matchType,
                confidence: crossing.confidence,
            };
            if (usedFileFallback)
                notes.push(TRACE_NOTES.fileBoundaryFallback);
            // PDG enrichment (opt-in): anchor on the RESOLVED boundary uids (which,
            // under the file fallback, are the trace endpoints themselves).
            const dataFlow = [];
            if (p.pdg) {
                const dfA = await enrichSegment(deps.port, fromEp.member, consumerUid, consumerNameFromHops(hopsA, consumerUid), p.pdgLimit, notes);
                if (dfA)
                    dataFlow.push(dfA);
                const dfB = await enrichSegment(deps.port, toEp.member, providerUid, providerNameFromHops(hopsB), p.pdgLimit, notes);
                if (dfB)
                    dataFlow.push(dfB);
            }
            const edges = [...edgesA, boundaryEdge, ...edgesB];
            const result = {
                status: 'ok',
                group: p.name,
                from: endpointFrom(fromEp),
                to: endpointFrom(toEp),
                crossings: [bridgeCrossing],
                hopCount: edges.length,
                hops: [...hopsA, ...hopsB],
                edges,
                notes,
                ...(dataFlow.length > 0 ? { dataFlow } : {}),
            };
            return result;
        }
        // Crossings exist but none connected both segments. If the crossing cap was
        // hit, this is NOT authoritative — a connecting link may rank beyond the cap.
        notes.push(TRACE_NOTES.noBridgeLink);
        return {
            status: 'not_found',
            group: p.name,
            ...(crossingsTruncated ? { truncated: true } : {}),
            notes,
            suggestion: crossingsTruncated
                ? `No connecting crossing among the ${MAX_CROSSINGS_TO_TRY} highest-confidence ` +
                    'ContractLinks tried, but more exist (truncated:true) — narrow with from_uid/to_uid, ' +
                    'or a higher maxDepth, before concluding no path exists.'
                : 'A ContractLink exists between the repos, but no local path reaches the consumer ' +
                    'call site or leaves the provider handler. Try a higher maxDepth.',
        };
    }
    finally {
        await closeBridgeDb(handle);
    }
}
// A source-scan fallback leaves a file basename as the symbol name when it could
// not resolve a real handler (e.g. `routes.ts`). Match only KNOWN source-file
// extensions — NOT any dotted name — so a legitimate method-style handler name
// (`users.list`, `UserController.index`) is not misclassified as anonymous.
const FILE_BASENAME_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|php|java|kt|kts|rb|cs|rs|swift|dart|scala|c|cc|cpp|cxx|h|hpp|m|mm)$/i;
/**
 * A provider endpoint's display label. A resolved handler has a real function
 * name; the source-scan fallbacks leave a generic token (`'handler'`/`'fetch'`,
 * or `'route'` for an unresolved named-controller / closure Laravel route) or a
 * file basename. Those are treated as anonymous and shown as
 * `<METHOD /path handler>` so the endpoint is still identifiable by route. When
 * the bridge row carries a resolved `providerUid`, the name IS a real symbol —
 * the sentinel check is suppressed so a function genuinely named `handler` (or,
 * hypothetically, `route`) is not mislabeled anonymous.
 */
function providerLabel(providerName, contractId, providerUid) {
    const resolved = providerUid !== '';
    const generic = providerName === '' ||
        FILE_BASENAME_RE.test(providerName) ||
        (!resolved &&
            (providerName === 'handler' || providerName === 'fetch' || providerName === 'route'));
    return generic
        ? { label: `<${contractId} handler>`, anon: true }
        : { label: providerName, anon: false };
}
/**
 * Destination trace: no `to` was given. Follow `from`'s outgoing HTTP call across
 * the bridge and report the provider endpoint it lands on — by route + file when
 * the handler is anonymous (the only way to reach a handler with no symbol).
 */
async function stitchToDestination(deps, p, fromEp, groupDir, degradedNoteList) {
    const bridgePrep = await ensureBridgeReady(groupDir);
    if ('error' in bridgePrep) {
        return { status: 'error', group: p.name, error: bridgePrep.error, notes: [] };
    }
    const handle = bridgePrep.handle;
    // Seed with degraded-member notes so EVERY outcome (success included) carries
    // them — a successful destination trace can still be incomplete if a member
    // repo could not be queried.
    const notes = [...degradedNoteList];
    if (p.crossDepthClamped)
        notes.push(TRACE_NOTES.crossDepthClamped);
    try {
        const { crossings, truncated } = await listCrossingsFrom(handle, fromEp.member.repoPath);
        if (crossings.length === 0) {
            notes.push(TRACE_NOTES.destinationNoLink);
            return {
                status: 'not_found',
                group: p.name,
                role: 'to',
                query: p.from_uid ?? p.from,
                notes,
                suggestion: 'Pass a `to` symbol for a symbol-to-symbol trace, or run group_sync.',
            };
        }
        if (truncated)
            notes.push(TRACE_NOTES.crossingsCapped(MAX_CROSSINGS_TO_TRY));
        const segACache = new Map();
        const traceTo = async (uid) => {
            const cached = segACache.get(uid);
            if (cached !== undefined)
                return cached;
            const raw = await deps.port.trace(fromEp.member.handle, {
                from_uid: fromEp.symbol.id,
                to_uid: uid,
                maxDepth: p.maxDepth,
                includeTests: p.includeTests,
            });
            const seg = asLocalTrace(raw);
            const r = seg && seg.status === 'ok' ? seg : null;
            segACache.set(uid, r);
            return r;
        };
        const precise = [];
        const fileLevel = [];
        for (const crossing of crossings) {
            if (crossing.consumerUid) {
                const segA = await traceTo(crossing.consumerUid);
                if (segA)
                    precise.push({ crossing, segA });
            }
            else if (sameFile(fromEp.symbol.filePath, crossing.consumerFile)) {
                const segA = await traceTo(fromEp.symbol.id);
                if (segA)
                    fileLevel.push({ crossing, segA });
            }
        }
        const endpointKey = (c) => `${c.providerRepo ?? ''} ${c.contractId}`;
        const distinct = (hits) => {
            const seen = new Set();
            const out = [];
            for (const h of hits) {
                const k = endpointKey(h.crossing);
                if (!seen.has(k)) {
                    seen.add(k);
                    out.push(h);
                }
            }
            return out;
        };
        const candidatesFrom = (hits) => distinct(hits).map((h) => ({
            repo: h.crossing.providerRepo ?? '',
            id: h.crossing.contractId,
            name: providerLabel(h.crossing.providerName ?? '', h.crossing.contractId, h.crossing.providerUid ?? '').label,
            filePath: h.crossing.providerFile,
            startLine: 0,
        }));
        const buildOk = (hit, fileLevelAnchor) => {
            const { crossing, segA } = hit;
            const providerRepo = crossing.providerRepo ?? '';
            const { label, anon } = providerLabel(crossing.providerName ?? '', crossing.contractId, crossing.providerUid ?? '');
            const hopsA = tagHops(segA.hops, fromEp.member.repoPath);
            const providerHop = {
                name: label,
                filePath: crossing.providerFile,
                startLine: 0,
                repo: providerRepo,
            };
            const edgesA = (segA.edges ?? []).map((e) => ({
                relType: e.relType,
                confidence: e.confidence,
            }));
            const boundaryEdge = { relType: 'CONTRACT_LINK', confidence: crossing.confidence };
            const resultNotes = [...notes];
            if (fileLevelAnchor)
                resultNotes.push(TRACE_NOTES.fileBoundaryFallback);
            if (anon) {
                resultNotes.push(TRACE_NOTES.anonymousHandler(crossing.contractId, `${providerRepo}:${crossing.providerFile}`));
            }
            return {
                status: 'ok',
                group: p.name,
                from: endpointFrom(fromEp),
                to: { name: label, filePath: crossing.providerFile, startLine: 0, repo: providerRepo },
                crossings: [
                    {
                        fromRepo: fromEp.member.repoPath,
                        toRepo: providerRepo,
                        contractId: crossing.contractId,
                        contractType: crossing.contractType,
                        matchType: crossing.matchType,
                        confidence: crossing.confidence,
                    },
                ],
                hopCount: edgesA.length + 1,
                hops: [...hopsA, providerHop],
                edges: [...edgesA, boundaryEdge],
                ...(truncated ? { truncated: true } : {}),
                notes: resultNotes,
            };
        };
        // Precise hits win. Crossings are pre-sorted by confidence, so the first
        // distinct precise hit is the strongest. More than one DISTINCT precise
        // endpoint means `from` genuinely reaches several — report it as ambiguous.
        const distinctPrecise = distinct(precise);
        if (distinctPrecise.length === 1)
            return buildOk(distinctPrecise[0], false);
        if (distinctPrecise.length > 1) {
            return {
                status: 'ambiguous',
                group: p.name,
                role: 'to',
                candidates: candidatesFrom(precise),
                notes: [...notes, TRACE_NOTES.destinationMultiple],
            };
        }
        // No precise hit — fall back to the file-level anchor, but ONLY when it is
        // unambiguous (a single endpoint). Multiple file-level endpoints cannot be
        // disambiguated without a resolved consumer uid, so report them as candidates
        // rather than guessing the highest-confidence one.
        const distinctFile = distinct(fileLevel);
        if (distinctFile.length === 1)
            return buildOk(distinctFile[0], true);
        if (distinctFile.length > 1) {
            return {
                status: 'ambiguous',
                group: p.name,
                role: 'to',
                candidates: candidatesFrom(fileLevel),
                notes: [...notes, TRACE_NOTES.destinationAmbiguousFile],
            };
        }
        notes.push(TRACE_NOTES.destinationNoReach);
        return {
            status: 'not_found',
            group: p.name,
            role: 'to',
            query: p.from_uid ?? p.from,
            ...(truncated ? { truncated: true } : {}),
            notes,
            suggestion: 'Trace from the function that issues the HTTP request, or pass a `to` symbol.',
        };
    }
    finally {
        await closeBridgeDb(handle);
    }
}
/** The consumer call site is the last hop of segment A; fall back to the uid. */
function consumerNameFromHops(hopsA, consumerUid) {
    return hopsA.length > 0 ? hopsA[hopsA.length - 1].name : consumerUid;
}
/** The provider handler is the first hop of segment B. */
function providerNameFromHops(hopsB) {
    return hopsB.length > 0 ? hopsB[0].name : 'provider';
}
