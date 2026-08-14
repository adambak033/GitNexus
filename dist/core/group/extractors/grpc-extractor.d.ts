import type { ContractExtractor, CypherExecutor } from '../contract-extractor.js';
import type { ExtractedContract, RepoHandle } from '../types.js';
export interface ProtoServiceInfo {
    package: string;
    /**
     * Optional. Value of `option java_package = "..."` declared in the
     * same `.proto` file, when present and different from `package`.
     * Empty string when the option is absent or equals `package`. Used by
     * `detectionToContract()` to translate a Java import path back to the
     * proto package whenever the proto explicitly publishes its generated
     * Java code under a different namespace (a common pattern in
     * Google-style protobuf projects).
     */
    javaPackage: string;
    serviceName: string;
    methods: string[];
    protoPath: string;
}
export declare function buildProtoMap(repoPath: string): Promise<Map<string, ProtoServiceInfo[]>>;
export declare function resolveProtoConflict(serviceName: string, sourceFilePath: string, candidates: ProtoServiceInfo[]): ProtoServiceInfo | null;
export declare function serviceContractId(pkg: string, serviceName: string): string;
export declare class GrpcExtractor implements ContractExtractor {
    type: "grpc";
    canExtract(_repo: RepoHandle): Promise<boolean>;
    extract(_dbExecutor: CypherExecutor | null, repoPath: string, _repo: RepoHandle): Promise<ExtractedContract[]>;
    /**
     * Convert a plugin `GrpcDetection` into a concrete `ExtractedContract`
     * by resolving the short service name against the proto map, building
     * either a service-level (`grpc::pkg.Svc/*`) or method-level
     * (`grpc::pkg.Svc/Method`) contract id, and selecting confidence
     * based on whether the proto map had an entry.
     *
     * Resolution order for the package prefix:
     *
     *   1. **Java-package translation** (when detection
     *      supplied a `protoPackage` from a Java import).
     *      A `.proto` in the SAME repo may set `option
     *      java_package = "..."` to publish its generated
     *      Java classes under a namespace different from
     *      the proto `package`. Real-world projects (e.g.
     *      Google Cloud Java APIs) routinely do this.
     *      When the import-derived package matches that
     *      `java_package` value, translate back to the
     *      proto `package` so the resulting contract id
     *      is wire-correct rather than Java-namespace.
     *
     *   2. **Per-repo proto map check** (when the same
     *      service name has `.proto` candidates in this
     *      repo). The proto file is the authoritative
     *      source. If the proto's `package` agrees with
     *      the import's `protoPackage`, both paths produce
     *      the same FQN — emit it. If they DISAGREE (e.g.
     *      a typo'd Java import, or a mismatched
     *      java_package the reverse index didn't catch),
     *      trust the proto map and warn — the import
     *      MUST NOT silently overwrite an authoritative
     *      proto package.
     *
     *   3. **Import-derived FQN fallback** (when neither
     *      a `java_package` translation nor a proto map
     *      candidate exists in this repo). Typical for the
     *      "client-jar" pattern, where a consumer repo
     *      depends on a published stub jar and never
     *      carries the originating `.proto`. Use the
     *      import path verbatim as the proto package. Note
     *      the known limitation: when the published proto
     *      sets `option java_package` differing from
     *      `package`, the resulting FQN reflects the Java
     *      namespace rather than the proto namespace and
     *      will not match a provider repo's contract id —
     *      we cannot translate without sight of the proto.
     *
     *   4. **Per-repo proto map (no import)** — the legacy
     *      path. Used when the plugin didn't supply
     *      `protoPackage` (no import statement, wildcard
     *      import only, or non-Java languages that haven't
     *      been retrofitted yet).
     *
     *   5. **Short-name fallback** — when none of the
     *      above resolves a package, emit a service-only
     *      short-name contract id (`grpc::Svc/*`),
     *      preserving the pre-fix behaviour.
     */
    private detectionToContract;
    private dedupe;
}
