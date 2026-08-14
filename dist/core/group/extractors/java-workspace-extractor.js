import fs from 'node:fs/promises';
import path from 'node:path';
import { shouldIgnorePath, loadIgnoreRules } from '../../../config/ignore-service.js';
import { logger } from '../../logger.js';
async function parseJavaManifest(repoPath) {
    const pomPath = path.join(repoPath, 'pom.xml');
    try {
        const content = await fs.readFile(pomPath, 'utf-8');
        return parsePom(content);
    }
    catch {
        // fall through to Gradle
    }
    for (const name of ['build.gradle.kts', 'build.gradle']) {
        const gradlePath = path.join(repoPath, name);
        try {
            const content = await fs.readFile(gradlePath, 'utf-8');
            return parseGradle(content, repoPath);
        }
        catch {
            continue;
        }
    }
    return null;
}
function parsePom(content) {
    const projectGroupMatch = content.match(/<project[^>]*>[\s\S]*?<groupId>([^<]+)<\/groupId>/);
    const projectArtifactMatch = content.match(/<project[^>]*>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/);
    if (!projectGroupMatch || !projectArtifactMatch)
        return null;
    const groupId = projectGroupMatch[1].trim();
    const artifactId = projectArtifactMatch[1].trim();
    const deps = [];
    const depBlocks = content.matchAll(/<dependency>\s*([\s\S]*?)<\/dependency>/g);
    for (const block of depBlocks) {
        const gMatch = block[1].match(/<groupId>([^<]+)<\/groupId>/);
        const aMatch = block[1].match(/<artifactId>([^<]+)<\/artifactId>/);
        if (gMatch && aMatch) {
            deps.push(`${gMatch[1].trim()}:${aMatch[1].trim()}`);
        }
    }
    return { groupId, artifactId, deps: [...new Set(deps)] };
}
function parseGradle(content, repoPath) {
    const groupMatch = content.match(/group\s*=\s*['"]([^'"]+)['"]/);
    const dirName = path.basename(repoPath);
    const groupId = groupMatch ? groupMatch[1] : '';
    if (!groupId)
        return null;
    const artifactId = dirName;
    const deps = [];
    // implementation("group:artifact:version") or api("group:artifact:version")
    const depMatches = content.matchAll(/(?:implementation|api|compileOnly|runtimeOnly)\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const m of depMatches) {
        const parts = m[1].split(':');
        if (parts.length >= 2) {
            deps.push(`${parts[0]}:${parts[1]}`);
        }
    }
    // implementation(project(":subproject"))
    const projDeps = content.matchAll(/(?:implementation|api)\s*\(\s*project\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g);
    for (const m of projDeps) {
        const subName = m[1].replace(/^:/, '');
        deps.push(`${groupId}:${subName}`);
    }
    return { groupId, artifactId, deps: [...new Set(deps)] };
}
function deriveBasePackage(groupId, artifactId) {
    const sanitized = artifactId.replace(/-/g, '.');
    if (groupId.endsWith(`.${sanitized}`) || groupId === sanitized) {
        return groupId;
    }
    return `${groupId}.${sanitized}`;
}
async function scanJavaImports(repoPath, knownPackages) {
    const results = [];
    const sourceFiles = await findJavaFiles(repoPath);
    for (const relFile of sourceFiles) {
        const absPath = path.join(repoPath, relFile);
        let content;
        try {
            content = await fs.readFile(absPath, 'utf-8');
        }
        catch {
            continue;
        }
        const importRegex = /^import\s+(?:static\s+)?([a-zA-Z][\w.]*\.[A-Z]\w*)/gm;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const fullImport = match[1];
            for (const [basePkg, artifactKey] of knownPackages) {
                if (fullImport.startsWith(basePkg + '.') || fullImport === basePkg) {
                    const parts = fullImport.split('.');
                    const className = parts[parts.length - 1];
                    if (isPascalCase(className)) {
                        results.push({
                            artifactKey,
                            symbolName: className,
                            filePath: relFile,
                        });
                    }
                    break;
                }
            }
        }
    }
    return results;
}
function isPascalCase(name) {
    return /^[A-Z][A-Za-z0-9]*$/.test(name);
}
async function findJavaFiles(repoPath) {
    const results = [];
    const ig = await loadIgnoreRules(repoPath);
    async function walk(dir, rel) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (shouldIgnorePath(childRel))
                    continue;
                if (ig && ig.ignores(childRel + '/'))
                    continue;
                await walk(path.join(dir, entry.name), childRel);
            }
            else if (entry.name.endsWith('.java') || entry.name.endsWith('.kt')) {
                if (shouldIgnorePath(childRel))
                    continue;
                if (ig && ig.ignores(childRel))
                    continue;
                results.push(childRel);
            }
        }
    }
    await walk(repoPath, '');
    return results;
}
export async function extractJavaWorkspaceLinks(repos, repoPaths, _dbExecutors) {
    const projectsByKey = new Map();
    const projectsByGroupPath = new Map();
    for (const [groupPath] of Object.entries(repos)) {
        const repoPath = repoPaths.get(groupPath);
        if (!repoPath)
            continue;
        const manifest = await parseJavaManifest(repoPath);
        if (!manifest)
            continue;
        const key = `${manifest.groupId}:${manifest.artifactId}`;
        const meta = {
            groupId: manifest.groupId,
            artifactId: manifest.artifactId,
            basePackage: deriveBasePackage(manifest.groupId, manifest.artifactId),
            groupPath,
            repoPath,
            deps: manifest.deps,
        };
        const existing = projectsByKey.get(key);
        if (existing) {
            logger.warn(`[java-workspace-extractor] duplicate artifact "${key}" in "${groupPath}" and "${existing.groupPath}" — skipping "${groupPath}"`);
            continue;
        }
        projectsByKey.set(key, meta);
        projectsByGroupPath.set(groupPath, meta);
    }
    const links = [];
    const seen = new Set();
    for (const [, proj] of projectsByGroupPath) {
        const groupDeps = proj.deps.filter((d) => projectsByKey.has(d));
        if (groupDeps.length === 0)
            continue;
        const knownPackages = new Map();
        for (const dep of groupDeps) {
            const depMeta = projectsByKey.get(dep);
            if (depMeta)
                knownPackages.set(depMeta.basePackage, dep);
        }
        const imports = await scanJavaImports(proj.repoPath, knownPackages);
        for (const imp of imports) {
            const providerProj = projectsByKey.get(imp.artifactKey);
            if (!providerProj)
                continue;
            const qualifiedContract = `${providerProj.artifactId}::${imp.symbolName}`;
            const dedupKey = `${proj.groupPath}→${providerProj.groupPath}::${qualifiedContract}`;
            if (seen.has(dedupKey))
                continue;
            seen.add(dedupKey);
            const link = {
                from: providerProj.groupPath,
                to: proj.groupPath,
                type: 'custom',
                contract: qualifiedContract,
                role: 'provider',
            };
            links.push(link);
        }
    }
    return { links, discoveredProjects: projectsByGroupPath };
}
