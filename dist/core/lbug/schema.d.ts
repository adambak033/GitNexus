/**
 * LadybugDB Schema Definitions
 *
 * Hybrid Schema:
 * - Separate node tables for each code element type (File, Function, Class, etc.)
 * - Single CodeRelation table with 'type' property for all relationships
 *
 * This allows LLMs to write natural Cypher queries like:
 *   MATCH (f:Function)-[r:CodeRelation {type: 'CALLS'}]->(g:Function) RETURN f, g
 */
import { NODE_TABLES, REL_TABLE_NAME, REL_TYPES, EMBEDDING_TABLE_NAME } from '../../_shared/index.js';
export { NODE_TABLES, REL_TABLE_NAME, REL_TYPES, EMBEDDING_TABLE_NAME };
export type { NodeTableName, RelType } from '../../_shared/index.js';
export declare const FILE_SCHEMA = "\nCREATE NODE TABLE File (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  content STRING,\n  PRIMARY KEY (id)\n)";
export declare const FOLDER_SCHEMA = "\nCREATE NODE TABLE Folder (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  PRIMARY KEY (id)\n)";
export declare const FUNCTION_SCHEMA = "\nCREATE NODE TABLE Function (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  isExported BOOLEAN,\n  content STRING,\n  description STRING,\n  PRIMARY KEY (id)\n)";
export declare const CLASS_SCHEMA = "\nCREATE NODE TABLE Class (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  isExported BOOLEAN,\n  content STRING,\n  description STRING,\n  frameworkAnnotations STRING[],\n  PRIMARY KEY (id)\n)";
export declare const INTERFACE_SCHEMA = "\nCREATE NODE TABLE Interface (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  isExported BOOLEAN,\n  content STRING,\n  description STRING,\n  PRIMARY KEY (id)\n)";
export declare const METHOD_SCHEMA = "\nCREATE NODE TABLE Method (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  isExported BOOLEAN,\n  content STRING,\n  description STRING,\n  parameterCount INT32,\n  returnType STRING,\n  PRIMARY KEY (id)\n)";
export declare const CODE_ELEMENT_SCHEMA = "\nCREATE NODE TABLE CodeElement (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  isExported BOOLEAN,\n  content STRING,\n  description STRING,\n  PRIMARY KEY (id)\n)";
export declare const COMMUNITY_SCHEMA = "\nCREATE NODE TABLE Community (\n  id STRING,\n  label STRING,\n  heuristicLabel STRING,\n  keywords STRING[],\n  description STRING,\n  enrichedBy STRING,\n  cohesion DOUBLE,\n  symbolCount INT32,\n  PRIMARY KEY (id)\n)";
export declare const PROCESS_SCHEMA = "\nCREATE NODE TABLE Process (\n  id STRING,\n  label STRING,\n  heuristicLabel STRING,\n  processType STRING,\n  stepCount INT32,\n  communities STRING[],\n  entryPointId STRING,\n  terminalId STRING,\n  PRIMARY KEY (id)\n)";
export declare const STRUCT_SCHEMA: string;
export declare const ENUM_SCHEMA: string;
export declare const MACRO_SCHEMA: string;
export declare const TYPEDEF_SCHEMA: string;
export declare const UNION_SCHEMA: string;
export declare const NAMESPACE_SCHEMA: string;
export declare const TRAIT_SCHEMA: string;
export declare const IMPL_SCHEMA: string;
export declare const TYPE_ALIAS_SCHEMA: string;
export declare const CONST_SCHEMA: string;
export declare const STATIC_SCHEMA: string;
export declare const VARIABLE_SCHEMA: string;
export declare const PROPERTY_SCHEMA = "\nCREATE NODE TABLE `Property` (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  content STRING,\n  description STRING,\n  declaredType STRING,\n  /*\n   * DETAIL SYMBOL \u2014 true when this property is a member of a shape that has no\n   * independent identity: the keys of an anonymous literal returned from a\n   * function (R3-4).\n   *\n   * It exists because indexing those keys is right for the GRAPH and wrong for\n   * TEXT SEARCH. They are ordinary words (message, value, timestamp) and\n   * there are many of them, so letting them into the FTS result set pushes the\n   * CALLABLES named after the same concept past the row cap the search applies\n   * \u2014 measured: query('message') went from two processes to none on the\n   * mini-repo fixture. A ranking tweak cannot fix that, because the rows never\n   * come back from the FTS call in the first place.\n   *\n   * So the search layer gained a notion it did not have \u2014 a symbol that is\n   * queryable, walkable and impact-analysable, but not a concept a text search\n   * should surface on its own. buildFtsQueryCypher excludes these for the\n   * Property table only; every other consumer sees them normally.\n   */\n  isDetail BOOLEAN,\n  PRIMARY KEY (id)\n)";
export declare const RECORD_SCHEMA: string;
export declare const DELEGATE_SCHEMA: string;
export declare const ANNOTATION_SCHEMA: string;
export declare const CONSTRUCTOR_SCHEMA: string;
export declare const TEMPLATE_SCHEMA: string;
export declare const MODULE_SCHEMA: string;
export declare const ROUTE_SCHEMA = "\nCREATE NODE TABLE Route (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  responseKeys STRING[],\n  errorKeys STRING[],\n  middleware STRING[],\n  method STRING,\n  handlerSymbolId STRING,\n  PRIMARY KEY (id)\n)";
export declare const TOOL_SCHEMA = "\nCREATE NODE TABLE Tool (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  description STRING,\n  PRIMARY KEY (id)\n)";
export declare const SECTION_SCHEMA = "\nCREATE NODE TABLE Section (\n  id STRING,\n  name STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  level INT64,\n  content STRING,\n  description STRING,\n  PRIMARY KEY (id)\n)";
export declare const BASICBLOCK_SCHEMA = "\nCREATE NODE TABLE BasicBlock (\n  id STRING,\n  filePath STRING,\n  startLine INT64,\n  endLine INT64,\n  text STRING,\n  callees STRING,\n  calleeIds STRING,\n  PRIMARY KEY (id)\n)";
/**
 * The 69 pairs NEITHER rule above generates — everything left after the two
 * cross products are subtracted. Carried by CONTAINMENT, inheritance, imports
 * and DI: a container label crossed with a contained label. No predicate
 * describes that surface (any container can hold any definition).
 *
 * What survives here is characteristic, not arbitrary. Almost all of it is a
 * TARGET no rule reaches — `CodeElement`, `Impl`, `Namespace`, `Template`,
 * `Typedef`, `Union`, `Static`, `Section`, `Folder` are in neither
 * `SCOPE_BRIDGE_TARGET_LABELS` nor {@link ATTACHMENT_TARGET_LABELS} — plus the
 * `Impl|*` and `Template|*` member rows (Rust `impl`/`trait` bodies, C++
 * templates), the two `Route|Process` / `Tool|Process` entry points whose
 * emitter names both labels as literals, and `BasicBlock|BasicBlock`, the PDG
 * substrate.
 *
 * NOTHING A RULE ALREADY COVERS BELONGS HERE. `generatedRelationPairs` skips
 * any pair present in this block, so a redundant line does not merely duplicate
 * — it SUPPRESSES generation, and later narrowing a rule would silently keep
 * that pair alive with no test failing. 166 such lines now live in the generated
 * half (161 from #2793, the three `Record` member pairs moved by #2801/#2871,
 * and the two `TypeAlias` pairs moved by R2-2 here);
 * `test/unit/schema-pair-coverage.test.ts` now fails if one comes back.
 *
 * Those last two arrived by MERGE, and the shape is worth recording because it
 * is the one this block's warning cannot catch by itself. #2871 and this branch
 * each deleted their OWN label's hand-written pairs — `Record` there,
 * `TypeAlias` here — for the identical reason, in the identical region. Git
 * presents that as one conflict in which each side appears to be deleting the
 * other's lines, and "keep ours" or "keep theirs" both resolve cleanly, compile,
 * and silently re-suppress the other label's generation. The correct resolution
 * is neither: take the UNION of the deletions. Verified by asserting all five
 * pairs are still present in the emitted DDL — a check that does not read
 * `LINKABLE_LABELS`, unlike the pair-coverage test, which derives both sides
 * from it and so moves with any change to it.
 *
 * Folding this remainder into a third cross product
 * (`DEFINITION_ANCHOR_LABELS × {CodeElement, Section, Typedef, Union,
 * Namespace, Impl, TypeAlias, Static, Template}`) would take the table to 641
 * pairs and leave only ~29 lines here. `bench/schema-pairs` measures 641 at
 * 1.22–1.43× on the historical reference box; current production's 461 pairs
 * remain below their 1.5× Windows budget. Those cross-machine values are not an
 * ordering, so any proposal must remeasure both sizes on one box. Until then,
 * the rule stays deferred rather than trading ~40 lines for unmeasured query cost.
 *
 * Exported so `test/unit/schema-pair-coverage.test.ts` can subtract it and
 * assert the GENERATED region of the DDL for exact equality against the two
 * rules, rather than one-directional containment.
 * `test/integration/structural-pair-coverage.test.ts` guards this half from a
 * corpus — that is the guard, not this comment.
 */
export declare const STRUCTURAL_PAIR_DDL = "  FROM File TO Folder,\n  FROM File TO CodeElement,\n  FROM File TO `Typedef`,\n  FROM File TO `Union`,\n  FROM File TO `Namespace`,\n  FROM File TO `Impl`,\n  FROM File TO `Static`,\n  FROM File TO `Template`,\n  FROM File TO Section,\n  FROM Folder TO Folder,\n  FROM Folder TO File,\n  FROM Function TO `Template`,\n  FROM Function TO `Namespace`,\n  FROM Function TO `Impl`,\n  FROM Function TO `Typedef`,\n  FROM Function TO `Union`,\n  FROM Function TO CodeElement,\n  FROM Class TO `Template`,\n  FROM Class TO `Impl`,\n  FROM Class TO `Union`,\n  FROM Class TO `Namespace`,\n  FROM Class TO `Typedef`,\n  FROM Class TO CodeElement,\n  FROM Method TO `Template`,\n  FROM Method TO `Namespace`,\n  FROM Method TO `Impl`,\n  FROM Method TO CodeElement,\n  FROM `Template` TO `Template`,\n  FROM `Template` TO Function,\n  FROM `Template` TO Method,\n  FROM `Template` TO Class,\n  FROM `Template` TO `Struct`,\n  FROM `Template` TO `TypeAlias`,\n  FROM `Template` TO `Enum`,\n  FROM `Template` TO `Macro`,\n  FROM `Template` TO Interface,\n  FROM `Template` TO `Constructor`,\n  FROM `Module` TO CodeElement,\n  FROM `Module` TO `Namespace`,\n  FROM `Namespace` TO Function,\n  FROM CodeElement TO CodeElement,\n  FROM CodeElement TO `Module`,\n  FROM CodeElement TO `Property`,\n  FROM Section TO Section,\n  FROM Interface TO CodeElement,\n  FROM `Namespace` TO `Struct`,\n  FROM `Impl` TO Method,\n  FROM `Impl` TO Function,\n  FROM `Impl` TO `Constructor`,\n  FROM `Impl` TO `Property`,\n  FROM `Impl` TO `Trait`,\n  FROM `Impl` TO `Struct`,\n  FROM `Impl` TO `Impl`,\n  FROM `Constructor` TO `Template`,\n  FROM `Constructor` TO `Impl`,\n  FROM `Constructor` TO `Namespace`,\n  FROM `Constructor` TO `Typedef`,\n  FROM Route TO Process,\n  FROM Tool TO Process,\n  FROM BasicBlock TO BasicBlock";
export declare const RELATION_SCHEMA: string;
export declare const EMBEDDING_DIMS: number;
/** HNSW vector index name for the CodeEmbedding table. */
export declare const EMBEDDING_INDEX_NAME = "code_embedding_idx";
/**
 * Sentinel value for "no content hash available" — used in legacy DBs and null rows.
 * Nodes with this hash are always treated as stale and re-embedded.
 */
export declare const STALE_HASH_SENTINEL = "";
export declare const EMBEDDING_SCHEMA: string;
/**
 * Create vector index for semantic search
 * Uses HNSW (Hierarchical Navigable Small World) algorithm with cosine similarity
 */
export declare const CREATE_VECTOR_INDEX_QUERY = "\nCALL CREATE_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 'embedding', metric := 'cosine')\n";
export declare const NODE_SCHEMA_QUERIES: string[];
export declare const REL_SCHEMA_QUERIES: string[];
export declare const SCHEMA_QUERIES: string[];
/**
 * Digest of the graph DDL this build creates — the exact statements
 * {@link runSchemaCreationQueries} (lbug-adapter.ts) executes for the node and
 * relation tables.
 *
 * This REPLACED `INCREMENTAL_SCHEMA_VERSION` (#2798), a hand-incremented
 * integer in repo-manager.ts that had to PREDICT whether an on-disk database
 * was created from this build's DDL. It could not: the number collided with
 * `main` eight times, twice EXACTLY, and an exact clash was the quiet failure —
 * two builds stamp the same number over different DDL, the strict `===` gate
 * reads the index as current, every `CREATE … TABLE` is skipped as "already
 * exists" (suppressed in `runSchemaCreationQueries`), and the edges whose
 * endpoint pair the live DB cannot persist are dropped by
 * `fallbackRelationshipInserts`' bare `catch`. A wrong graph, not an error.
 *
 * A digest cannot collide BY ACCIDENT at this scale: 12 hex chars is 48 bits,
 * so even 1,000 distinct DDL variants over the project's whole life put the
 * birthday probability of any pair matching at ≈1.8e-9. Two builds agree
 * exactly when their DDL agrees, so concurrent branches never need renumbering.
 * Do not shorten the slice: the odds double per bit dropped. On mismatch —
 * including the ABSENT stamp every pre-#2798 index carries — run-analyze warns
 * and forces a full re-analyze, which wipes the database and recreates the
 * tables from the DDL below.
 *
 * {@link EMBEDDING_SCHEMA} is deliberately EXCLUDED. Its `FLOAT[N]` width comes
 * from `GITNEXUS_EMBEDDING_DIMS` at module load, so folding it in would make
 * this a function of the ENVIRONMENT rather than of code: two runs of the same
 * build under different env would disagree and force alternating full rebuilds.
 * Vector-column drift is therefore a SEPARATE gate, not an ungated hazard:
 * {@link embeddingDimsMismatch} compares the width stamped in
 * `RepoMeta.embeddingDims` against {@link EMBEDDING_DIMS} and run-analyze
 * forces a rebuild on drift. Do not merge the two — an env-derived value in a
 * code digest makes the same build disagree with itself. (The older reaction in
 * run-analyze remains, and is to the CACHE, not the schema: when the cached
 * vectors' length differs from `EMBEDDING_DIMS` it discards the cache and
 * re-embeds.)
 */
export declare const SCHEMA_FINGERPRINT: string;
/**
 * Whether an index built under `recorded` can be reused by this build.
 *
 * Lives here rather than in run-analyze so the query side can ask the same
 * question without importing the analyze pipeline — the reason
 * `cjkSegmentationModeMismatch` sits in `core/search/` rather than beside its
 * caller. ABSENT counts as a mismatch: that is the backward-compatibility path
 * for every index written before the field existed, and grandfathering it would
 * stamp a fresh fingerprint onto a database whose DDL was never verified.
 */
export declare const schemaFingerprintMismatch: (recorded: string | undefined) => boolean;
/**
 * Whether a stamped value has the shape {@link SCHEMA_FINGERPRINT} produces —
 * the lowercase-hex prefix of a sha256 digest. The width is read from the live
 * constant, so changing the slice above needs no edit here.
 *
 * Used to decide whether a stamp is worth NAMING in a diagnostic: an index with
 * no fingerprint and one carrying a malformed value are both "not this build",
 * but only the first has an explanation worth printing. Not a comparison gate —
 * {@link schemaFingerprintMismatch} already rejects every value that is not
 * exactly this build's.
 */
export declare const isSchemaFingerprintShaped: (value: unknown) => value is string;
/**
 * Whether the vector-column width an index's `CodeEmbedding` table was created
 * at (as persisted in `RepoMeta.embeddingDims`) differs from the width this
 * process would embed at ({@link EMBEDDING_DIMS}). The gate
 * {@link SCHEMA_FINGERPRINT} deliberately cannot be: `FLOAT[N]` comes from
 * `GITNEXUS_EMBEDDING_DIMS` at module load, so folding it into a digest of the
 * DDL would make that digest a function of the ENVIRONMENT. Splitting it out
 * here keeps the fingerprint purely code-derived and still gates the width —
 * before this, flipping `GITNEXUS_EMBEDDING_DIMS` on a same-commit clean tree
 * fired no guard at all: `alreadyUpToDate` returned over a `FLOAT[384]` table
 * while the process embedded at 768. (The one pre-existing reaction, in
 * run-analyze, discards the embedding CACHE and re-embeds — into a column whose
 * width was never revisited.) A single scalar, so plain equality suffices.
 *
 * ABSENT does NOT count as a mismatch — the opposite of
 * {@link schemaFingerprintMismatch}, and deliberately:
 *
 *  - Absence carries no signal about the width. A missing fingerprint means
 *    "DDL this build cannot vouch for", and the field ships WITH a DDL change,
 *    so absence is itself evidence of drift. A missing dims stamp means only
 *    "written before the field existed"; the width was whatever that run's env
 *    resolved, almost always the 384 default, and it was consistent with the
 *    table it wrote. Drift needs the env to CHANGE, which absence says nothing
 *    about.
 *  - Forcing on absence would buy no safety anyway. Every index that lacks this
 *    stamp also lacks `schemaFingerprint` (both landed together in #2798), and
 *    that guard already forces a rebuild for exactly those indexes — after
 *    which the width is stamped and the hazard is closed for good. A second
 *    trigger for the same one rebuild is dead weight that would keep firing
 *    forever on any future path that legitimately omits the stamp.
 *  - The cost of guessing wrong is asymmetric: a fleet-wide full re-analyze
 *    (minutes to hours per repo) for a hazard that requires a rare, deliberate
 *    env change.
 *
 * Absence is precisely `undefined`. Any other recorded value that is not this
 * build's width — including a malformed one, since `meta.json` is a schema-less
 * `JSON.parse` of on-disk state — reads as a mismatch and errs toward a
 * rebuild, which is the safe direction.
 *
 * Pure + exported for testing, and takes `current` explicitly rather than
 * closing over {@link EMBEDDING_DIMS}: that constant is frozen at module load,
 * so a parameter is the only way to exercise both sides of the comparison.
 * Lives here rather than in run-analyze for the reason
 * `cjkSegmentationModeMismatch` lives in `core/search/` — a caller that only
 * needs the comparator should not have to pull in the analyze pipeline.
 */
export declare const embeddingDimsMismatch: (recorded: number | undefined, current: number) => boolean;
