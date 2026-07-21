/**
 * Regression test for issue #2605: `rename` must report every edit it applies.
 *
 * The apply step does a whole-file `\boldName\b` global replace on each touched
 * file, but the reported `changes`/`total_edits` were built from a partial
 * enumeration that (a) recorded only the definition line, (b) recorded one edit
 * per graph-ref file then broke, and (c) skipped text-search on any file already
 * covered by the graph. When a private symbol's definition and all its call
 * sites live in one file, only the definition line was reported (total_edits: 1)
 * while apply rewrote every occurrence. This test drives the exact single-file
 * case with an empty graph (no incoming refs) and asserts report == apply.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Prevent onnxruntime / native search adapters from loading at import time
// (mirrors test/unit/calltool-dispatch.test.ts). We drive the private rename()
// directly, so the graph/DB/embedding layers are never exercised.
vi.mock('../../src/core/search/bm25-index.js', () => ({
  searchFTSFromLbug: vi.fn().mockResolvedValue({ results: [], ftsAvailable: true }),
}));
vi.mock('../../src/mcp/core/embedder.js', () => ({
  embedQuery: vi.fn().mockResolvedValue([]),
  getEmbeddingDims: vi.fn().mockReturnValue(384),
}));

import { LocalBackend } from '../../src/mcp/local/local-backend.js';

// The #2605 repro: a private free fn with exactly 4 textual occurrences of
// `rename_target` — the definition, one production call, two test calls — all
// in the same file.
const RUST_SRC = `fn rename_target(x: u32) -> u32 {
    x + 1
}

pub fn prod_call() -> u32 {
    rename_target(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_one() {
        assert_eq!(rename_target(1), 2);
    }

    #[test]
    fn unit_two() {
        assert_eq!(rename_target(2), 3);
    }
}
`;

// 1-based occurrence lines of `rename_target` in RUST_SRC — the ground truth the
// report must match. Computed from the fixture (not hardcoded) so editing the
// snippet cannot silently desync the expectation.
const OCCURRENCE_LINES = RUST_SRC.split('\n')
  .map((line, i) => (/\brename_target\b/.test(line) ? i + 1 : 0))
  .filter((n) => n > 0);

/** Build a backend whose graph lookup returns the symbol with NO incoming refs
 *  (the exact condition that made the old code report only the definition). */
function stubbedBackend(): LocalBackend {
  const backend = new LocalBackend();
  vi.spyOn(
    backend as unknown as { ensureInitialized: () => Promise<void> },
    'ensureInitialized',
  ).mockResolvedValue(undefined);
  vi.spyOn(backend as unknown as { context: () => Promise<unknown> }, 'context').mockResolvedValue({
    status: 'success',
    symbol: { name: 'rename_target', filePath: 'src/lib.rs', startLine: OCCURRENCE_LINES[0] },
    incoming: { calls: [], imports: [], extends: [], implements: [] },
  });
  return backend;
}

describe('rename edit report is faithful to apply (#2605)', () => {
  let backend: LocalBackend;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gn-2605-'));
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'lib.rs'), RUST_SRC, 'utf-8');
    backend = stubbedBackend();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('previews every occurrence that apply will rewrite (dry_run)', async () => {
    const result = await (
      backend as unknown as { rename: (r: unknown, p: unknown) => Promise<any> }
    ).rename(
      { repoPath: tmpDir },
      { symbol_name: 'rename_target', new_name: 'renamed_fn', dry_run: true },
    );

    expect(result.applied).toBe(false);
    expect(result.files_affected).toBe(1);
    expect(result.total_edits).toBe(OCCURRENCE_LINES.length); // 4, not 1
    expect(result.graph_edits + result.text_search_edits).toBe(result.total_edits);

    const reportedLines = result.changes[0].edits
      .map((e: { line: number }) => e.line)
      .sort((a: number, b: number) => a - b);
    expect(reportedLines).toEqual(OCCURRENCE_LINES);

    // A dry run leaves the file untouched.
    const onDisk = await fs.readFile(path.join(tmpDir, 'src', 'lib.rs'), 'utf-8');
    expect(onDisk).toContain('rename_target');
  });

  it('reports exactly what it wrote (apply)', async () => {
    const result = await (
      backend as unknown as { rename: (r: unknown, p: unknown) => Promise<any> }
    ).rename(
      { repoPath: tmpDir },
      { symbol_name: 'rename_target', new_name: 'renamed_fn', dry_run: false },
    );

    expect(result.applied).toBe(true);
    expect(result.total_edits).toBe(OCCURRENCE_LINES.length);

    const onDisk = await fs.readFile(path.join(tmpDir, 'src', 'lib.rs'), 'utf-8');
    const renamedCount = (onDisk.match(/\brenamed_fn\b/g) || []).length;
    const stragglers = (onDisk.match(/\brename_target\b/g) || []).length;
    expect(renamedCount).toBe(OCCURRENCE_LINES.length); // all 4 rewritten
    expect(stragglers).toBe(0);

    // The reported edit count equals the number of replacements that landed.
    const reportedEdits = result.changes.reduce(
      (n: number, c: { edits: unknown[] }) => n + c.edits.length,
      0,
    );
    expect(reportedEdits).toBe(renamedCount);
  });
});
