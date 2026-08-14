import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const yaml = _require('js-yaml');
const VALID_CONTRACT_TYPES = [
    'http',
    'grpc',
    'thrift',
    'topic',
    'lib',
    'custom',
    'include',
];
const VALID_ROLES = ['provider', 'consumer'];
// Defaults matter for backward compatibility: any group.yaml that omits a
// `detect.<type>` key inherits its value from this constant. Adding a new
// extractor that defaults to `true` silently changes the behavior of every
// existing group on the next sync. New extractors must default to `false`
// (opt-in) so operators consciously enable them via group.yaml.
//
// `includes`: opt-in. The C/C++ IncludeExtractor (PR #1156) ships disabled by
// default; enable with `detect.includes: true` for groups containing C/C++
// repos that need cross-repo header tracking.
const DEFAULT_DETECT = {
    http: true,
    grpc: true,
    thrift: true,
    topics: true,
    shared_libs: true,
    embedding_fallback: true,
    includes: false,
    workspace_deps: false,
};
const DEFAULT_MATCHING = {
    bm25_threshold: 0.7,
    embedding_threshold: 0.65,
    max_candidates_per_step: 3,
    exclude_links_paths: [],
    exclude_links_param_only_paths: false,
};
export function parseGroupConfig(yamlContent) {
    const raw = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Invalid YAML: expected an object');
    }
    if (raw.version === undefined)
        throw new Error('version is required in group.yaml');
    if (raw.version !== 1) {
        throw new Error(`Unsupported group.yaml version: ${raw.version}. Expected 1.`);
    }
    if (!raw.name || typeof raw.name !== 'string')
        throw new Error('name is required in group.yaml');
    if (!raw.repos || typeof raw.repos !== 'object' || Array.isArray(raw.repos)) {
        throw new Error('repos is required in group.yaml (must be a mapping)');
    }
    const repos = raw.repos;
    const repoPaths = new Set(Object.keys(repos));
    const rawLinks = raw.links || [];
    const links = rawLinks.map((l, i) => {
        const link = l;
        if (!link.from || !repoPaths.has(link.from)) {
            throw new Error(`links[${i}].from "${link.from}" does not match any repo path in group`);
        }
        if (!link.to || !repoPaths.has(link.to)) {
            throw new Error(`links[${i}].to "${link.to}" does not match any repo path in group`);
        }
        if (!VALID_CONTRACT_TYPES.includes(link.type)) {
            throw new Error(`links[${i}].type "${link.type}" is invalid. Expected: ${VALID_CONTRACT_TYPES.join(', ')}`);
        }
        if (!VALID_ROLES.includes(link.role)) {
            throw new Error(`links[${i}].role "${link.role}" is invalid. Expected: provider | consumer`);
        }
        if (link.contract === undefined ||
            link.contract === null ||
            String(link.contract).trim() === '') {
            throw new Error(`links[${i}].contract is required`);
        }
        return {
            from: link.from,
            to: link.to,
            type: link.type,
            contract: String(link.contract),
            role: link.role,
        };
    });
    const detect = { ...DEFAULT_DETECT, ...(raw.detect || {}) };
    const matching = { ...DEFAULT_MATCHING, ...(raw.matching || {}) };
    const packages = raw.packages || {};
    return {
        version: 1,
        name: raw.name,
        description: raw.description || '',
        repos,
        links,
        packages,
        detect,
        matching,
    };
}
export class GroupNotFoundError extends Error {
    groupName;
    constructor(groupName) {
        super(`Group "${groupName}" not found`);
        this.groupName = groupName;
        this.name = 'GroupNotFoundError';
    }
}
export async function loadGroupConfig(groupDir) {
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const yamlPath = path.join(groupDir, 'group.yaml');
    let content;
    try {
        content = await fsp.readFile(yamlPath, 'utf-8');
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            throw new GroupNotFoundError(path.basename(groupDir));
        }
        throw err;
    }
    return parseGroupConfig(content);
}
