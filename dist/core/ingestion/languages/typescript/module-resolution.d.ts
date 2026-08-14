/**
 * TypeScript / JavaScript module resolution (#2953).
 *
 * This is the algorithm `tsc` and Node actually run, in the order they run it.
 * It replaces `import-resolvers/utils.ts:suffixResolve` on the TS/JS/Vue path,
 * which answered a different question — "does any file in this repo have a path
 * ending in this specifier?" — and answered it by dropping leading segments
 * until something matched. That is why `@acme/telemetry/nest`, a registry
 * dependency, landed on the repo's only path ending in `nest/index.ts`.
 *
 * Every rule below resolves against something DECLARED: a real path, a
 * `tsconfig` mapping, or a `package.json` manifest. A specifier that matches
 * none of them is external, and external resolves to nothing. There is
 * deliberately no fallback: a guess is what this module exists to remove, and
 * an edge nobody declared is worse than a missing one precisely because it
 * cannot be told apart from a real one downstream.
 *
 * ## The order, and why it is this order
 *
 *   1. relative / absolute — a path is a path; nothing else can claim it.
 *   2. `#`-prefixed — package.json `imports`, which is scoped to the importing
 *      package and shadows everything else by design.
 *   3. tsconfig `paths` — explicit mappings win over `baseUrl`, and the LONGEST
 *      matching pattern wins among them (tsc's rule, not first-declared).
 *   4. tsconfig `baseUrl` — the rule that makes `import 'src/utils/foo'` legal.
 *      Note it applies only when a config actually declares one; without it,
 *      TypeScript treats a non-relative specifier as a package lookup, and so
 *      does this module.
 *   5. workspace package — the manifest map, resolved through that package's
 *      own `exports` / `main` / `module` / `types`.
 *   6. anything else — external. `null`.
 */
import type { NodeWorkspacePackages } from '../../import-resolvers/node-workspace-packages.js';
import { type TsconfigIndex } from './tsconfig.js';
export interface TsModuleResolutionContext {
    readonly fromFile: string;
    readonly allFilePaths: ReadonlySet<string>;
    readonly tsconfigs: TsconfigIndex | null;
    readonly workspacePackages: NodeWorkspacePackages | null;
}
/**
 * Resolve one specifier to a repo file, or `null` when nothing in the repo
 * declares it.
 */
export declare function resolveTsModule(specifier: string, ctx: TsModuleResolutionContext): string | null;
/** Whether a specifier names a package rather than a path — used by callers
 *  that want to report an unresolved import as external rather than missing. */
export declare function isPackageSpecifier(specifier: string): boolean;
