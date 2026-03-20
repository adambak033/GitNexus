import { describe, it, expect } from 'vitest';
import { topologicalLevelSort, computeImportCycleSCCs } from '../../src/core/ingestion/pipeline.js';

describe('topologicalLevelSort', () => {
  it('returns empty levels for empty graph', () => {
    const importMap = new Map<string, Set<string>>();
    const levels = topologicalLevelSort(importMap);
    expect(levels).toEqual([]);
  });

  it('returns single level for files with no imports', () => {
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set()],
    ]);
    const levels = topologicalLevelSort(importMap);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toContain('a.ts');
    expect(levels[0]).toContain('b.ts');
  });

  it('orders files by dependency depth', () => {
    // b imports a, c imports b → a first, then b, then c
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['b.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toContain('a.ts');
    expect(levels[1]).toContain('b.ts');
    expect(levels[2]).toContain('c.ts');
  });

  it('groups independent files at the same level', () => {
    // b and c both import a → a at level 0, b and c at level 1
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['a.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toContain('a.ts');
    expect(levels[1]).toContain('b.ts');
    expect(levels[1]).toContain('c.ts');
  });

  it('handles cycles by grouping them in a final level', () => {
    // a imports b, b imports a — circular
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['a.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    // Both should appear (in a cycle group)
    const allFiles = levels.flat();
    expect(allFiles).toContain('a.ts');
    expect(allFiles).toContain('b.ts');
  });

  it('handles disconnected components', () => {
    // Two independent groups with no cross-links
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set(['a.ts'])],
      ['x.ts', new Set()],
      ['y.ts', new Set(['x.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    // Level 0 has both roots, level 1 has both dependents
    expect(levels[0]).toContain('a.ts');
    expect(levels[0]).toContain('x.ts');
    expect(levels[1]).toContain('b.ts');
    expect(levels[1]).toContain('y.ts');
  });

  it('handles diamond dependencies', () => {
    // d imports b and c; b and c both import a
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['a.ts'])],
      ['d.ts', new Set(['b.ts', 'c.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toContain('a.ts');
    expect(levels[1]).toContain('b.ts');
    expect(levels[1]).toContain('c.ts');
    expect(levels[2]).toContain('d.ts');
  });

  it('handles a single file with no imports', () => {
    const importMap = new Map<string, Set<string>>([
      ['only.ts', new Set()],
    ]);
    const levels = topologicalLevelSort(importMap);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toContain('only.ts');
  });

  it('handles a dependency on a file not explicitly in the map', () => {
    // b imports external.ts which is not itself a key in importMap
    const importMap = new Map<string, Set<string>>([
      ['b.ts', new Set(['external.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    // external.ts has in-degree 0 (no one depends on it as a key), appears first
    // b.ts depends on external.ts so appears after
    const allFiles = levels.flat();
    expect(allFiles).toContain('external.ts');
    expect(allFiles).toContain('b.ts');
    const externalLevel = levels.findIndex(l => l.includes('external.ts'));
    const bLevel = levels.findIndex(l => l.includes('b.ts'));
    expect(externalLevel).toBeLessThan(bLevel);
  });

  it('handles a cycle mixed with an acyclic dependent', () => {
    // a and b are cyclic; c depends on b (and ends up in cycle group too
    // because b never reaches in-degree 0)
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['b.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    // No file has in-degree 0 to start: a needs b, b needs a, c needs b
    // All end up in the cycle group
    const allFiles = levels.flat();
    expect(allFiles).toContain('a.ts');
    expect(allFiles).toContain('b.ts');
    expect(allFiles).toContain('c.ts');
  });

  it('all files appear exactly once across all levels', () => {
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['a.ts'])],
      ['d.ts', new Set(['b.ts', 'c.ts'])],
    ]);
    const levels = topologicalLevelSort(importMap);
    const allFiles = levels.flat();
    const uniqueFiles = new Set(allFiles);
    expect(uniqueFiles.size).toBe(allFiles.length);
    expect(uniqueFiles.size).toBe(4);
  });
});

describe('computeImportCycleSCCs', () => {
  it('returns no SCCs for empty cycle nodes', () => {
    const importMap = new Map<string, Set<string>>();
    const result = computeImportCycleSCCs(importMap, []);
    expect(result.sccs).toHaveLength(0);
    expect(result.cycleFiles).toHaveLength(0);
  });

  it('detects a simple two-node cycle A→B→A as one SCC', () => {
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['a.ts'])],
    ]);
    const result = computeImportCycleSCCs(importMap, ['a.ts', 'b.ts']);
    expect(result.sccs).toHaveLength(1);
    expect(result.sccs[0]).toHaveLength(2);
    expect(result.sccs[0]).toContain('a.ts');
    expect(result.sccs[0]).toContain('b.ts');
    expect(result.cycleFiles).toContain('a.ts');
    expect(result.cycleFiles).toContain('b.ts');
  });

  it('detects two independent cycles as two SCCs', () => {
    // A→B→A and C→D→C are separate cycles
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['d.ts'])],
      ['d.ts', new Set(['c.ts'])],
    ]);
    const result = computeImportCycleSCCs(importMap, ['a.ts', 'b.ts', 'c.ts', 'd.ts']);
    expect(result.sccs).toHaveLength(2);
    const allInSccs = result.sccs.flat();
    expect(allInSccs).toContain('a.ts');
    expect(allInSccs).toContain('b.ts');
    expect(allInSccs).toContain('c.ts');
    expect(allInSccs).toContain('d.ts');
  });

  it('filters out single-node components (not true cycles)', () => {
    // A single node with no self-loop is not an SCC of size ≥2
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set()],
    ]);
    const result = computeImportCycleSCCs(importMap, ['a.ts']);
    expect(result.sccs).toHaveLength(0);
    expect(result.cycleFiles).toHaveLength(0);
  });

  it('detects a three-node cycle A→B→C→A as one SCC alongside an independent two-node cycle', () => {
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['c.ts'])],
      ['c.ts', new Set(['a.ts'])],
      ['d.ts', new Set(['e.ts'])],
      ['e.ts', new Set(['d.ts'])],
    ]);
    const result = computeImportCycleSCCs(importMap, ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']);
    expect(result.sccs).toHaveLength(2);
    const sizes = result.sccs.map(s => s.length).sort((x, y) => x - y);
    expect(sizes).toEqual([2, 3]);
  });

  it('cycleFiles is the union of all SCC members', () => {
    const importMap = new Map<string, Set<string>>([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['a.ts'])],
      ['c.ts', new Set(['d.ts'])],
      ['d.ts', new Set(['c.ts'])],
    ]);
    const cycleNodes = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const result = computeImportCycleSCCs(importMap, cycleNodes);
    expect(new Set(result.cycleFiles)).toEqual(new Set(result.sccs.flat()));
    expect(result.cycleFiles).toHaveLength(4);
  });
});
