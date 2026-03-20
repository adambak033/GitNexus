/**
 * Index Command
 *
 * Registers an existing .gitnexus/ folder into the global registry so the
 * MCP server can discover the repo without running a full `gitnexus analyze`.
 *
 * Useful when a pre-built .gitnexus/ directory is already present (e.g. after
 * cloning a repo that ships its index, restoring from backup, or using a
 * shared team index).
 */

import path from 'path';
import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import {
  getStoragePaths,
  loadMeta,
  registerRepo,
  addToGitignore,
  getGlobalRegistryPath,
} from '../storage/repo-manager.js';
import { getGitRoot, isGitRepo } from '../storage/git.js';

export interface IndexOptions {
  force?: boolean;
}

export const indexCommand = async (
  inputPathParts?: string[],
  options?: IndexOptions,
) => {
  console.log('\n  GitNexus Index\n');

  const inputPath = inputPathParts?.length ? inputPathParts.join(' ') : undefined;

  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      console.log('  Not inside a git repository, try to run git init\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  const { storagePath, lbugPath, metaPath } = getStoragePaths(repoPath);

  // ── Verify .gitnexus/ exists ──────────────────────────────────────
  try {
    await fs.access(storagePath);
  } catch {
    console.log(`  No .gitnexus/ folder found at: ${storagePath}`);
    console.log('  Run `gitnexus analyze` to build the index first.\n');
    process.exitCode = 1;
    return;
  }

  // ── Verify lbug database exists ───────────────────────────────────
  try {
    await fs.access(lbugPath);
  } catch {
    console.log(`  .gitnexus/ folder exists but contains no LadybugDB index.`);
    console.log('  Run `gitnexus analyze` to build the index.\n');
    process.exitCode = 1;
    return;
  }

  // ── Load or reconstruct meta ──────────────────────────────────────
  let meta = await loadMeta(storagePath);

  if (!meta) {
    if (!options?.force) {
      console.log(`  .gitnexus/ exists but meta.json is missing.`);
      console.log('  Use --force to register anyway (stats will be empty),');
      console.log('  or run `gitnexus analyze` to rebuild properly.\n');
      process.exitCode = 1;
      return;
    }

    // --force: build a minimal meta so the repo can be registered
    meta = {
      repoPath,
      lastCommit: '',
      indexedAt: new Date().toISOString(),
    };
  }

  // ── Register in global registry ───────────────────────────────────
  await registerRepo(repoPath, meta);
  await addToGitignore(repoPath);

  const projectName = path.basename(repoPath);
  const { stats } = meta;

  console.log(`  Repository registered: ${projectName}`);
  if (stats) {
    const parts: string[] = [];
    if (stats.nodes != null) parts.push(`${stats.nodes.toLocaleString()} nodes`);
    if (stats.edges != null) parts.push(`${stats.edges.toLocaleString()} edges`);
    if (stats.communities != null) parts.push(`${stats.communities} clusters`);
    if (stats.processes != null) parts.push(`${stats.processes} flows`);
    if (parts.length) console.log(`  ${parts.join(' | ')}`);
  }
  console.log(`  ${repoPath}`);

  try {
    await fs.access(getGlobalRegistryPath());
  } catch {
    console.log('\n  Tip: Run `gitnexus setup` to configure MCP for your editor.');
  }

  console.log('');
};
