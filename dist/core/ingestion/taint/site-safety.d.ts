/**
 * Taint-site safety validation (#2083 M3 U1, plan KTD2).
 *
 * Mirrors `hasEmitSafeFacts` (cfg/emit.ts): an untrusted `cfgSideChannel`
 * element — possibly from a corrupted durable parsedfile store — must never
 * crash the taint pass or fabricate matches from out-of-range indices. The
 * degradation contract is per-FUNCTION and one-directional: a CFG whose sites
 * fail this check is SKIPPED FOR TAINT ONLY — the BasicBlock/CFG layer and
 * the REACHING_DEF projection (guarded by their own checks) are unaffected.
 *
 * Checked: exactly the indices the taint matcher dereferences — binding
 * indices (`receiver`/`object`/`resultDefs`/arg occurrences) against the
 * function's binding table, and intra-statement site references (`parent`
 * site / via-tags) against the OWNING statement's `sites` array. Site
 * references are statement-local by construction (each statement's
 * FactAccumulator starts at index 0); a cross-statement reference is
 * corruption, not a feature.
 *
 * Lives in `taint/` (not cfg/emit.ts): U4's taint emit path is the only
 * consumer, and the guard must evolve with the matcher that dereferences
 * these fields.
 */
import type { FunctionCfg } from '../cfg/types.js';
/**
 * Whether a structurally-valid CFG's M3 `sites` annotations are safe to feed
 * to the taint matcher/propagator. `true` when no statement carries sites
 * (pre-M3 channel, or no calls) — absence is the well-formed empty case.
 */
export declare const hasTaintSafeSites: (cfg: FunctionCfg) => boolean;
