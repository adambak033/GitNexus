import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const mockAccess = vi.fn();
const mockGetStoragePaths = vi.fn();
const mockLoadMeta = vi.fn();
const mockRegisterRepo = vi.fn();
const mockGetGitRoot = vi.fn();
const mockIsGitRepo = vi.fn();

vi.mock('fs/promises', () => ({
  default: {
    access: mockAccess,
  },
}));

vi.mock('../../src/storage/repo-manager.js', () => ({
  getStoragePaths: mockGetStoragePaths,
  loadMeta: mockLoadMeta,
  registerRepo: mockRegisterRepo,
}));

vi.mock('../../src/storage/git.js', () => ({
  getGitRoot: mockGetGitRoot,
  isGitRepo: mockIsGitRepo,
}));

describe('indexCommand', () => {
  const resolvedRepo = path.resolve('/repo');
  const resolvedOutside = path.resolve('/outside/path');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.exitCode = undefined;

    mockGetStoragePaths.mockImplementation((repoPath: string) => ({
      storagePath: `${repoPath}/.gitnexus`,
      lbugPath: `${repoPath}/.gitnexus/lbug`,
      metaPath: `${repoPath}/.gitnexus/meta.json`,
    }));
    mockLoadMeta.mockResolvedValue({
      repoPath: resolvedRepo,
      lastCommit: 'abc123',
      indexedAt: '2026-03-20T00:00:00.000Z',
      stats: { nodes: 10, edges: 20 },
    });
    mockAccess.mockResolvedValue(undefined);
    mockGetGitRoot.mockReturnValue(resolvedRepo);
    mockIsGitRepo.mockReturnValue(true);
  });

  it('fails when target path is not a git repository', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockIsGitRepo.mockReturnValue(false);

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/outside/path']);

    expect(mockRegisterRepo).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(`  Not a git repository: ${resolvedOutside}`);
  });

  it('fails when .gitnexus folder does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockAccess.mockRejectedValueOnce(new Error('missing .gitnexus'));

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/repo']);

    expect(mockRegisterRepo).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(`  No .gitnexus/ folder found at: ${resolvedRepo}/.gitnexus`);
  });

  it('fails when lbug database does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('missing lbug'));

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/repo']);

    expect(mockRegisterRepo).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith('  .gitnexus/ folder exists but contains no LadybugDB index.');
  });

  it('fails when meta.json is missing and --force is not set', async () => {
    mockLoadMeta.mockResolvedValue(null);

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/repo']);

    expect(mockRegisterRepo).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('registers with minimal metadata when meta is missing and --force is set', async () => {
    mockLoadMeta.mockResolvedValue(null);

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/repo'], { force: true });

    expect(mockRegisterRepo).toHaveBeenCalledTimes(1);
    expect(mockRegisterRepo).toHaveBeenCalledWith(
      resolvedRepo,
      expect.objectContaining({
        repoPath: resolvedRepo,
        lastCommit: '',
      }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('registers successfully with existing metadata', async () => {
    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/repo']);

    expect(mockRegisterRepo).toHaveBeenCalledTimes(1);
    expect(mockRegisterRepo).toHaveBeenCalledWith(
      resolvedRepo,
      expect.objectContaining({ repoPath: resolvedRepo }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('registers non-git path when --allow-non-git is set', async () => {
    mockIsGitRepo.mockReturnValue(false);

    const { indexCommand } = await import('../../src/cli/index-repo.js');
    await indexCommand(['/outside/path'], { allowNonGit: true });

    expect(mockRegisterRepo).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });
});
