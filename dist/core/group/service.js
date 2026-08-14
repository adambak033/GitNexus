/**
 * Group orchestration shared by MCP (LocalBackend) and CLI.
 * DB access is injected via GroupToolPort so this module stays free of LocalBackend private API.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { checkStaleness } from '../git-staleness.js';
import { loadMeta } from '../../storage/repo-manager.js';
import { GroupNotFoundError, loadGroupConfig } from './config-parser.js';
import { fileMatchesServicePrefix, normalizeServicePrefix, repoInSubgroup, } from './group-path-utils.js';
import { getDefaultGitnexusDir, getGroupDir, listGroups, readContractRegistry } from './storage.js';
// `./sync.js` is imported LAZILY in `groupSync` — see the comment at its call
// site. It statically pulls the six contract extractors and, through them, the
// native tree-sitter binding; a static import here puts all of that on MCP
// server startup, which never syncs.
import { logger } from '../logger.js';
function isStoredContract(raw) {
    if (!raw || typeof raw !== 'object')
        return false;
    const o = raw;
    return (typeof o.contractId === 'string' &&
        typeof o.type === 'string' &&
        typeof o.repo === 'string' &&
        typeof o.role === 'string' &&
        (o.role === 'provider' || o.role === 'consumer') &&
        typeof o.symbolUid === 'string' &&
        typeof o.symbolName === 'string' &&
        typeof o.confidence === 'number' &&
        o.meta !== undefined &&
        typeof o.meta === 'object' &&
        o.meta !== null &&
        o.symbolRef !== undefined &&
        typeof o.symbolRef === 'object' &&
        o.symbolRef !== null &&
        typeof o.symbolRef.filePath === 'string' &&
        typeof o.symbolRef.name === 'string');
}
function filterQueryByServicePrefix(queryResult, servicePrefix) {
    const symbols = (queryResult.process_symbols || []).filter((s) => fileMatchesServicePrefix(typeof s.filePath === 'string' ? s.filePath : undefined, servicePrefix));
    const allowed = new Set(symbols.map((s) => String(s.process_id ?? '')).filter(Boolean));
    const processes = (queryResult.processes || []).filter((p) => allowed.has(String(p.id)));
    return { processes, process_symbols: symbols };
}
function isCrossLink(raw) {
    if (!raw || typeof raw !== 'object')
        return false;
    const o = raw;
    const from = o.from;
    const to = o.to;
    if (!from || !to)
        return false;
    if (typeof from.repo !== 'string' || typeof to.repo !== 'string')
        return false;
    return typeof o.contractId === 'string' && typeof o.type === 'string';
}
async function loadContractRegistryResilient(groupDir) {
    const filePath = path.join(groupDir, 'contracts.json');
    let raw;
    try {
        raw = await fsp.readFile(filePath, 'utf-8');
    }
    catch (e) {
        if (e.code === 'ENOENT') {
            return { ok: false, error: `No contracts.json for this group. Run group_sync first.` };
        }
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    let root;
    try {
        root = JSON.parse(raw);
    }
    catch {
        return { ok: false, error: 'contracts.json is not valid JSON' };
    }
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
        return { ok: false, error: 'contracts.json has an invalid root object' };
    }
    const base = root;
    const contractsRaw = base.contracts;
    const crossRaw = base.crossLinks;
    let skippedCorrupt = 0;
    const contracts = [];
    if (Array.isArray(contractsRaw)) {
        for (const row of contractsRaw) {
            try {
                if (isStoredContract(row)) {
                    contracts.push(row);
                }
                else {
                    skippedCorrupt++;
                    logger.warn('[group] skipping corrupt contract row in contracts.json');
                }
            }
            catch {
                skippedCorrupt++;
                logger.warn('[group] skipping corrupt contract row in contracts.json');
            }
        }
    }
    const crossLinks = [];
    if (Array.isArray(crossRaw)) {
        for (const row of crossRaw) {
            try {
                if (isCrossLink(row)) {
                    crossLinks.push(row);
                }
                else {
                    skippedCorrupt++;
                    logger.warn('[group] skipping corrupt crossLinks row in contracts.json');
                }
            }
            catch {
                skippedCorrupt++;
                logger.warn('[group] skipping corrupt crossLinks row in contracts.json');
            }
        }
    }
    const registry = {
        version: typeof base.version === 'number' ? base.version : 0,
        generatedAt: typeof base.generatedAt === 'string' ? base.generatedAt : '',
        repoSnapshots: base.repoSnapshots && typeof base.repoSnapshots === 'object' && base.repoSnapshots !== null
            ? base.repoSnapshots
            : {},
        missingRepos: Array.isArray(base.missingRepos) ? base.missingRepos : [],
        contracts,
        crossLinks,
    };
    return { ok: true, registry, skippedCorrupt };
}
export class GroupService {
    port;
    constructor(port) {
        this.port = port;
    }
    async groupList(params) {
        const name = typeof params.name === 'string' ? params.name.trim() : '';
        if (!name) {
            const groups = await listGroups();
            return { groups };
        }
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        let config;
        try {
            config = await loadGroupConfig(groupDir);
        }
        catch (err) {
            if (err instanceof GroupNotFoundError)
                return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
            throw err;
        }
        return {
            name: config.name,
            description: config.description,
            repos: config.repos,
            links: config.links,
        };
    }
    async groupSync(params) {
        const name = String(params.name ?? '').trim();
        if (!name)
            return { error: 'name is required' };
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        let config;
        try {
            config = await loadGroupConfig(groupDir);
        }
        catch (err) {
            if (err instanceof GroupNotFoundError)
                return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
            throw err;
        }
        // Lazy: `sync.js` reaches the six contract extractors and the native
        // tree-sitter binding. `groupSync` is the ONLY consumer — the other seven
        // group tools never need it — so deferring it here keeps that closure off
        // MCP server startup entirely and off every non-sync group call. The CLI
        // already does exactly this at `cli/group.ts`'s sync command.
        const { syncGroup } = await import('./sync.js');
        const result = await syncGroup(config, {
            groupDir,
            exactOnly: Boolean(params.exactOnly),
            skipEmbeddings: Boolean(params.skipEmbeddings),
            allowStale: Boolean(params.allowStale),
            verbose: Boolean(params.verbose),
        });
        return {
            contracts: result.contracts.length,
            crossLinks: result.crossLinks.length,
            unmatched: result.unmatched.length,
            missingRepos: result.missingRepos,
        };
    }
    async groupContracts(params) {
        const name = String(params.name ?? '').trim();
        if (!name)
            return { error: 'name is required' };
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        const loaded = await loadContractRegistryResilient(groupDir);
        if (loaded.ok === false) {
            if (loaded.error.includes('No contracts.json')) {
                return { error: `No contracts.json for group "${name}". Run group_sync first.` };
            }
            return { error: loaded.error };
        }
        const { registry, skippedCorrupt } = loaded;
        let contracts = registry.contracts;
        if (params.type)
            contracts = contracts.filter((c) => c.type === params.type);
        if (params.repo)
            contracts = contracts.filter((c) => c.repo === params.repo);
        if (params.unmatchedOnly) {
            const matchedIds = new Set(registry.crossLinks.flatMap((l) => [
                `${l.from.repo}::${l.contractId}`,
                `${l.to.repo}::${l.contractId}`,
            ]));
            contracts = contracts.filter((c) => !matchedIds.has(`${c.repo}::${c.contractId}`));
        }
        const out = { contracts, crossLinks: registry.crossLinks };
        if (skippedCorrupt > 0)
            out.skippedCorrupt = skippedCorrupt;
        return out;
    }
    async groupImpact(params) {
        const { runGroupImpact } = await import('./cross-impact.js');
        return runGroupImpact({ port: this.port, gitnexusDir: getDefaultGitnexusDir() }, params);
    }
    async groupTrace(params) {
        const { runGroupTrace } = await import('./cross-trace.js');
        return runGroupTrace({ port: this.port, gitnexusDir: getDefaultGitnexusDir() }, params);
    }
    async groupContext(params) {
        const name = String(params.name ?? '').trim();
        const target = typeof params.target === 'string' ? params.target.trim() : '';
        const uid = typeof params.uid === 'string' ? params.uid.trim() : undefined;
        const file_path = typeof params.file_path === 'string' ? params.file_path : undefined;
        const include_content = Boolean(params.include_content);
        if (params.service !== undefined &&
            params.service !== null &&
            String(params.service).trim() === '') {
            return { group: name || '', error: 'service must not be an empty string', results: [] };
        }
        const servicePrefix = normalizeServicePrefix(params.service);
        const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
        const subgroupExact = params.subgroupExact === true;
        if (!name) {
            return { group: '', error: 'name is required', results: [] };
        }
        if (!uid && !target) {
            return { group: name, error: 'target or uid is required', results: [] };
        }
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        let config;
        try {
            config = await loadGroupConfig(groupDir);
        }
        catch (e) {
            if (e instanceof GroupNotFoundError)
                return {
                    group: name,
                    target: target || uid,
                    service: servicePrefix,
                    error: `Group "${name}" not found. Run group_list to see configured groups.`,
                    results: [],
                };
            return {
                group: name,
                target: target || uid,
                service: servicePrefix,
                error: e instanceof Error ? e.message : String(e),
                results: [],
            };
        }
        const memberEntries = Object.entries(config.repos).filter(([repoPath]) => repoInSubgroup(repoPath, subgroup, subgroupExact));
        const results = await Promise.all(memberEntries.map(async ([repoPath, registryName]) => {
            try {
                const repoObj = await this.port.resolveRepo(registryName);
                const payload = await this.port.context(repoObj, {
                    name: target || undefined,
                    uid,
                    file_path,
                    include_content,
                });
                if (servicePrefix) {
                    const st = payload?.status;
                    const sym = payload?.symbol;
                    if (st === 'found' && !fileMatchesServicePrefix(sym?.filePath, servicePrefix)) {
                        return { repoPath, registryName, payload: {} };
                    }
                }
                return { repoPath, registryName, payload };
            }
            catch (e) {
                return {
                    repoPath,
                    registryName,
                    payload: { error: e instanceof Error ? e.message : String(e) },
                };
            }
        }));
        return {
            group: name,
            target: target || uid,
            service: servicePrefix,
            results,
        };
    }
    async groupQuery(params) {
        const name = String(params.name ?? '').trim();
        const queryText = String(params.query ?? '').trim();
        if (!name || !queryText)
            return { error: 'name and query are required' };
        if (params.service !== undefined &&
            params.service !== null &&
            String(params.service).trim() === '') {
            return { error: 'service must not be an empty string' };
        }
        const servicePrefix = normalizeServicePrefix(params.service);
        const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : 5;
        const subgroup = typeof params.subgroup === 'string' ? params.subgroup : undefined;
        const subgroupExact = params.subgroupExact === true;
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        let config;
        try {
            config = await loadGroupConfig(groupDir);
        }
        catch (err) {
            if (err instanceof GroupNotFoundError)
                return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
            throw err;
        }
        const memberEntries = Object.entries(config.repos).filter(([repoPath]) => repoInSubgroup(repoPath, subgroup, subgroupExact));
        const perRepo = await Promise.all(memberEntries.map(async ([repoPath, registryName]) => {
            try {
                const repoObj = await this.port.resolveRepo(registryName);
                const queryResult = (await this.port.query(repoObj, {
                    query: queryText,
                    limit,
                    max_symbols: 10,
                    include_content: false,
                }));
                const processes = servicePrefix
                    ? filterQueryByServicePrefix(queryResult, servicePrefix).processes
                    : queryResult.processes || [];
                const scored = processes.map((p, idx) => ({
                    ...p,
                    _rrf_score: 1 / (idx + 1 + 60),
                    _repo: repoPath,
                }));
                return { repo: repoPath, score: 0, processes: scored };
            }
            catch {
                return { repo: repoPath, score: 0, processes: [] };
            }
        }));
        const allProcesses = perRepo.flatMap((r) => r.processes);
        allProcesses.sort((a, b) => b._rrf_score - a._rrf_score);
        const topN = allProcesses.slice(0, limit);
        return {
            group: name,
            query: queryText,
            results: topN,
            per_repo: perRepo.map((r) => ({ repo: r.repo, count: r.processes.length })),
        };
    }
    async groupStatus(params) {
        const name = String(params.name ?? '').trim();
        if (!name)
            return { error: 'name is required' };
        const groupDir = getGroupDir(getDefaultGitnexusDir(), name);
        let config;
        try {
            config = await loadGroupConfig(groupDir);
        }
        catch (err) {
            if (err instanceof GroupNotFoundError)
                return { error: `Group "${name}" not found. Run group_list to see configured groups.` };
            throw err;
        }
        const registry = await readContractRegistry(groupDir);
        const repoStatuses = {};
        for (const [repoPath, registryName] of Object.entries(config.repos)) {
            try {
                const repoObj = await this.port.resolveRepo(registryName);
                const meta = (await loadMeta(repoObj.storagePath)) ?? {};
                const staleness = meta.lastCommit
                    ? checkStaleness(repoObj.repoPath, meta.lastCommit)
                    : { isStale: true, commitsBehind: -1 };
                const snapshot = registry?.repoSnapshots[repoPath];
                const contractsStale = snapshot && meta.indexedAt ? snapshot.indexedAt !== meta.indexedAt : !snapshot;
                repoStatuses[repoPath] = {
                    indexStale: staleness.isStale,
                    contractsStale: Boolean(contractsStale),
                    missing: false,
                    commitsBehind: staleness.commitsBehind,
                };
            }
            catch {
                repoStatuses[repoPath] = { indexStale: false, contractsStale: false, missing: true };
            }
        }
        return {
            group: name,
            lastSync: registry?.generatedAt || null,
            missingRepos: registry?.missingRepos || [],
            repos: repoStatuses,
        };
    }
}
