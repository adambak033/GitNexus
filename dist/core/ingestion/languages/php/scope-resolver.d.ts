/**
 * PHP `ScopeResolver` registered in `SCOPE_RESOLVERS` and consumed by
 * the generic `runScopeResolution` orchestrator (RFC #909 Ring 3 LANG-php).
 *
 * Third migration after Python and C#. See `pythonScopeResolver` for the
 * canonical shape.
 *
 * ## Circular-import avoidance
 *
 * The old PR had `php/scope-resolver.ts` importing `phpProvider` from
 * `../php.js` while `php.ts` imported `phpScopeResolver` from `./php/index.js`
 * — undefined at module load. The canonical fix (mirroring C#):
 *
 *   - `scope-resolver.ts` imports `phpProvider` from `../php.js` ✓
 *   - `php.ts` imports individual hook FUNCTIONS from `./php/index.js` ✗
 *
 * Node's ESM handles the cycle correctly because `phpProvider` is a named
 * export that is live-binding — by the time `phpScopeResolver` is first
 * read (lazily, at resolution time), `phpProvider` is fully initialized.
 */
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
declare const phpScopeResolver: ScopeResolver;
export { phpScopeResolver };
