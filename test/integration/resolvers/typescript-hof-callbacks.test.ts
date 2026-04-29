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
    result = await runPipelineFromRepo(path.join(FIXTURES, 'typescript-hof-callbacks'), () => {});
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

  it('Zustand module-level calls source from the File node (not a sibling Function)', () => {
    // The positive complement to the anti-self-loop assertion above:
    // module-level calls in `store.ts` (`create()`, `devtools(...)`,
    // `persist(...)`) MUST attribute to the `File` node — that's the
    // entire point of `isCallerAnchorLabel` excluding `Variable` from
    // the caller-walk fallback. If the fix regresses (Variable defs
    // re-enter the fallback, or the walk-up grabs a sibling Function),
    // the source would change away from `File:store.ts`.
    //
    // Earlier formulation iterated `for (c of calls)` and asserted each
    // edge sourced from File. That passed VACUOUSLY when `calls` was
    // empty — any change that silenced ALL CALLS edges from `store.ts`
    // would have slipped through. The structural assertion below is
    // explicit: at least one File-rooted edge must exist (proving the
    // fallback fired), and no edge may source from anything else
    // (proving the fallback fired EXCLUSIVELY, not as one option
    // alongside a buggy sibling-Function attribution).
    const calls = getRelationships(result, 'CALLS').filter(
      (c) => c.sourceFilePath === 'src/store.ts',
    );
    const fromFile = calls.filter((c) => c.sourceLabel === 'File' && c.source === 'store.ts');
    const fromOther = calls.filter((c) => !(c.sourceLabel === 'File' && c.source === 'store.ts'));
    expect(fromOther, 'no module-level call may attribute to a non-File source').toEqual([]);
    expect(fromFile.length, 'at least one File-rooted call edge must exist').toBeGreaterThan(0);
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
