/**
 * TypeScript: CALLS edges from inside higher-order-function callbacks.
 *
 * Repro for the bug filed in `gitnexus-bug-report.md`: in a real
 * TS+React monorepo, ~75% of `Function` nodes had no outgoing CALLS
 * edges. The dominant pattern was call expressions nested inside
 * callbacks passed as arguments to other functions:
 *
 *   - `Promise.all(items.map(item => transform(item)))`
 *   - `useQuery({ queryFn: () => fetchData() })`
 *   - `new Promise((resolve) => { reader.readAsDataURL(file); ... })`
 *   - `create<State>()(devtools(persist((set) => ({ ... }))))` (Zustand)
 *
 * Two underlying issues fixed by this PR (see `query.ts` and
 * `finalize-algorithm.ts`):
 *
 *   1. **Caller attribution.** `pass2AttachDeclarations` placed the
 *      `Function` def for arrow-typed declarations on the wrapping
 *      module scope (the `@declaration.function` anchor was the outer
 *      `lexical_declaration`, whose start lies before the inner
 *      arrow's scope). `resolveCallerGraphId` walked up past the empty
 *      arrow scope into the module and grabbed the first Function-like
 *      def in `ownedDefs` — frequently the wrong function entirely.
 *
 *   2. **Cross-file callee discovery.** TypeScript emits BOTH
 *      `@declaration.function` (Function def) AND `@declaration.variable`
 *      (Variable def) for `const fn = () => {}`. With (1) fixed, the
 *      Function-def's anchor moved to the inner arrow, so the Variable
 *      capture began appearing FIRST in `localDefs` (its match starts
 *      earlier in the source). `findExportByName` returned the
 *      Variable, the consumer's import bound to a non-callable, and
 *      `findCallableBindingInScope` rejected it.
 *
 * Each test fixture below isolates one HOF-callback shape from the bug
 * report with both caller and callee defined in-fixture.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES,
  getRelationships,
  edgeSet,
  runPipelineFromRepo,
  type PipelineResult,
} from './helpers.js';

describe('TypeScript HOF-callback CALLS edges', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'typescript-hof-callbacks'),
      () => {},
    );
  }, 60000);

  it('control: direct (x) => transform(x) emits direct → transform', () => {
    const calls = getRelationships(result, 'CALLS').filter((c) => c.target === 'transform');
    expect(edgeSet(calls)).toContain('direct → transform');
  });

  it('Promise.all(map(...)) emits fanOut → transform (call inside .map callback)', () => {
    const calls = getRelationships(result, 'CALLS').filter((c) => c.target === 'transform');
    // `fanOut` is the named arrow declaration; the call to `transform`
    // is syntactically nested inside `.map(...)` inside `Promise.all(...)`.
    expect(edgeSet(calls)).toContain('fanOut → transform');
  });

  it('new Promise((resolve) => { ... }) emits wrap → transform (call inside executor)', () => {
    const calls = getRelationships(result, 'CALLS').filter((c) => c.target === 'transform');
    expect(edgeSet(calls)).toContain('wrap → transform');
  });

  it('useQuery({ queryFn: () => fetchData() }) emits useFeature → fetchData (call inside queryFn callback)', () => {
    const calls = getRelationships(result, 'CALLS').filter((c) => c.target === 'fetchData');
    expect(edgeSet(calls)).toContain('useFeature → fetchData');
  });

  it('useQuery({ queryFn: () => fetchData() }) emits useFeature → useQuery (direct call in body)', () => {
    const calls = getRelationships(result, 'CALLS').filter((c) => c.target === 'useQuery');
    expect(edgeSet(calls)).toContain('useFeature → useQuery');
  });

  it('Zustand create()(devtools(persist((set) => ({ ... })))) does NOT emit phantom self-loops', () => {
    // The Zustand idiom `export const useStore = create()(devtools(persist((set) => ({ ... }))))`
    // has its module-level call expressions (`create()`, `devtools(...)`,
    // `persist(...)`) in `useStore`'s declaration RHS, syntactically
    // outside any function body. The bug-report case
    // (`grouped-file-uploads-store.tsx`, "0% capture") was driven by
    // these calls being mis-attributed to a sibling Function (the
    // first declared callable in the module's `ownedDefs`), producing
    // bogus self-loops like `Function:create → Function:create`. The
    // fix in `resolveCallerGraphId` excludes Variable defs from the
    // walk-up's class-fallback branch — module-level calls now fall
    // through to the File node like any other module-level reference.
    //
    // What this test asserts: NO phantom self-loops, and NO phantom
    // edges where one local function "calls" a sibling local
    // function via misattribution.
    const calls = getRelationships(result, 'CALLS').filter(
      (c) => c.sourceFilePath === 'src/store.ts' && c.targetFilePath === 'src/store.ts',
    );
    const phantomSelfLoops = calls.filter((c) => c.source === c.target);
    expect(phantomSelfLoops, 'phantom self-loop CALLS edges').toEqual([]);

    // Specifically the regression: `create → create / devtools / persist`.
    const fromCreate = calls.filter((c) => c.source === 'create');
    expect(fromCreate, 'create() must not be a phantom caller').toEqual([]);
  });

  it('Zustand call expressions are attributable (to File or absent — never to a wrong sibling)', () => {
    // The complement check: if any CALLS edge is emitted for the
    // module-scope calls in store.ts, its source must be either
    // `store.ts` (the File fallback) or undefined. We accept zero
    // edges here as a valid outcome; the strict assertion is the
    // anti-self-loop one above.
    const calls = getRelationships(result, 'CALLS').filter(
      (c) => c.sourceFilePath === 'src/store.ts',
    );
    for (const c of calls) {
      // Source must NOT be a sibling local Function. The only
      // acceptable source for module-level calls in store.ts is the
      // File node itself (label 'File', name 'store.ts').
      expect([c.sourceLabel, c.source]).toEqual(['File', 'store.ts']);
    }
  });

  it('transform is reachable from at least 3 of {direct, fanOut, wrap}', () => {
    // Catch-all: pre-fix, only `direct → transform` was captured (or
    // even THAT was missing depending on file order). After fix, all
    // three callers attribute their `transform` call correctly.
    const callers = new Set(
      getRelationships(result, 'CALLS')
        .filter((c) => c.target === 'transform')
        .map((c) => c.source),
    );
    expect(callers).toContain('direct');
    expect(callers).toContain('fanOut');
    expect(callers).toContain('wrap');
  });
});
