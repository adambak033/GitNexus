import { describe, it, expect } from 'vitest';
import { extractRepoName, getCloneDir } from '../../src/server/git-clone.js';

describe('git-clone', () => {
  describe('extractRepoName', () => {
    it('extracts name from HTTPS URL', () => {
      expect(extractRepoName('https://github.com/user/my-repo.git')).toBe('my-repo');
    });

    it('extracts name from HTTPS URL without .git suffix', () => {
      expect(extractRepoName('https://github.com/user/my-repo')).toBe('my-repo');
    });

    it('extracts name from SSH URL', () => {
      expect(extractRepoName('git@github.com:user/my-repo.git')).toBe('my-repo');
    });

    it('handles trailing slashes', () => {
      expect(extractRepoName('https://github.com/user/my-repo/')).toBe('my-repo');
    });

    it('handles nested paths', () => {
      expect(extractRepoName('https://gitlab.com/group/subgroup/repo.git')).toBe('repo');
    });
  });

  describe('getCloneDir', () => {
    it('returns path under ~/.gitnexus/repos/', () => {
      const dir = getCloneDir('my-repo');
      expect(dir).toContain('.gitnexus');
      expect(dir).toMatch(/repos/);
      expect(dir).toContain('my-repo');
    });
  });
});
