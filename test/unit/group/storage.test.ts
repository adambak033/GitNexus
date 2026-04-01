import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  getGroupDir,
  getGroupsBaseDir,
  writeContractRegistry,
  readContractRegistry,
  listGroups,
} from '../../../src/core/group/storage.js';
import type { ContractRegistry } from '../../../src/core/group/types.js';

describe('Group storage', () => {
  const tmpDir = path.join(os.tmpdir(), `gitnexus-test-storage-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getGroupsBaseDir returns ~/.gitnexus/groups/', () => {
    const base = getGroupsBaseDir(tmpDir);
    expect(base).toBe(path.join(tmpDir, 'groups'));
  });

  it('getGroupDir returns correct path for group name', () => {
    const dir = getGroupDir(tmpDir, 'company');
    expect(dir).toBe(path.join(tmpDir, 'groups', 'company'));
  });

  it('writeContractRegistry writes atomically and readContractRegistry reads back', async () => {
    const groupDir = path.join(tmpDir, 'groups', 'test-group');
    fs.mkdirSync(groupDir, { recursive: true });

    const registry: ContractRegistry = {
      version: 1,
      generatedAt: '2026-03-31T10:00:00Z',
      repoSnapshots: {},
      missingRepos: [],
      contracts: [],
      crossLinks: [],
    };

    await writeContractRegistry(groupDir, registry);

    const filePath = path.join(groupDir, 'contracts.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = await readContractRegistry(groupDir);
    expect(loaded?.version).toBe(1);
    expect(loaded?.generatedAt).toBe('2026-03-31T10:00:00Z');
  });

  it('readContractRegistry returns null when file does not exist', async () => {
    const groupDir = path.join(tmpDir, 'groups', 'nonexistent');
    fs.mkdirSync(groupDir, { recursive: true });
    const result = await readContractRegistry(groupDir);
    expect(result).toBeNull();
  });

  it('listGroups returns group names', async () => {
    const groupsDir = path.join(tmpDir, 'groups');
    fs.mkdirSync(path.join(groupsDir, 'company'), { recursive: true });
    fs.writeFileSync(
      path.join(groupsDir, 'company', 'group.yaml'),
      'version: 1\nname: company\nrepos:\n  a: b',
    );
    fs.mkdirSync(path.join(groupsDir, 'personal'), { recursive: true });
    fs.writeFileSync(
      path.join(groupsDir, 'personal', 'group.yaml'),
      'version: 1\nname: personal\nrepos:\n  c: d',
    );

    const groups = await listGroups(tmpDir);
    expect(groups.sort()).toEqual(['company', 'personal']);
  });
});
