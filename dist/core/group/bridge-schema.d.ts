/**
 * Bridge LadybugDB schema for cross-repo Contract Registry.
 * Separate from per-repo schema in lbug/schema.ts.
 */
/**
 * Version of the bridge.lbug schema below. `openBridgeDbReadOnly` compares
 * this against `meta.json`'s version field and returns `null` on mismatch,
 * which trips the caller into either the JSON fallback path or a fresh
 * `group sync` that rebuilds `bridge.lbug` from scratch.
 *
 * Migration contract for contributors bumping this constant:
 *   1. Bump the number (e.g. `1` → `2`).
 *   2. Update the DDL below to match the new schema.
 *   3. DO NOT attempt an online migration in this file — the version gate
 *      is intentionally a "discard and re-sync" strategy for V1. An old
 *      bridge.lbug whose version doesn't match is treated as opaque and
 *      rebuilt by the next `group sync`.
 *   4. If online migration becomes necessary (e.g. when groups accumulate
 *      large amounts of embedding data), add a migration path as a
 *      separate `bridge-migrations.ts` module rather than bloating this
 *      file — keep schema and migration concerns separate.
 */
export declare const BRIDGE_SCHEMA_VERSION = 1;
export declare const CONTRACT_SCHEMA = "\nCREATE NODE TABLE Contract (\n  id STRING,\n  contractId STRING,\n  type STRING,\n  role STRING,\n  repo STRING,\n  service STRING DEFAULT '',\n  symbolUid STRING DEFAULT '',\n  filePath STRING DEFAULT '',\n  symbolName STRING DEFAULT '',\n  confidence DOUBLE DEFAULT 0.0,\n  meta STRING DEFAULT '{}',\n  PRIMARY KEY (id)\n)";
export declare const REPO_SNAPSHOT_SCHEMA = "\nCREATE NODE TABLE RepoSnapshot (\n  id STRING,\n  indexedAt STRING DEFAULT '',\n  lastCommit STRING DEFAULT '',\n  PRIMARY KEY (id)\n)";
export declare const CONTRACT_LINK_SCHEMA = "\nCREATE REL TABLE ContractLink (\n  FROM Contract TO Contract,\n  matchType STRING,\n  confidence DOUBLE,\n  contractId STRING,\n  fromRepo STRING,\n  toRepo STRING\n)";
export declare const BRIDGE_SCHEMA_QUERIES: string[];
