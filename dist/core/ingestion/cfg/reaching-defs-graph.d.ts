/**
 * Pure graph sub-stages for the reaching-definitions solvers (#2201 review R4).
 *
 * Extracted from reaching-defs.ts to keep that module focused on the
 * orchestrator, the dense oracle, the statement sweep, and the dispatcher.
 * Everything here is a pure function of plain arrays — no CFG, no harvest, no
 * solver state — so this module has NO dependency on reaching-defs.ts (a strict
 * one-way import) and each stage is independently testable. The SSA pipeline
 * (dominators → dominance frontiers → Tarjan SCC → reach-set condensation)
 * implements Cooper-Harvey-Kennedy + Cytron + Tarjan; reverse-post-order, the
 * loop-reachability check, and the def-set/lattice primitives are shared with
 * the dense GEN/KILL solver and the dispatcher.
 *
 * These are held byte-identical to their former inline form by the differential
 * equivalence fuzz (test/unit/cfg/reaching-defs-equivalence.test.ts) — any diff
 * after extraction is an extraction bug, never the oracle.
 */
export {};
