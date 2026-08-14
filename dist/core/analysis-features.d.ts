/** A durable statement that one analysis capability was produced by this build. */
export interface AnalysisFeatureDescriptor {
    readonly id: string;
    readonly version: number;
    readonly appliesTo: (filePaths: readonly string[]) => boolean;
}
export type AnalysisFeatureVersions = Readonly<Record<string, number>>;
/**
 * The Class table shape is global even when a repository contains no JVM code.
 * Existing v8 indexes predate the frameworkAnnotations column and therefore
 * need one full rebuild before any incremental Class write can be safe.
 */
export declare const CLASS_FRAMEWORK_ANNOTATIONS_FEATURE: AnalysisFeatureDescriptor;
/** Resolve the exact feature set this build promises for the supplied files. */
export declare function resolveAnalysisFeatureVersions(descriptors: readonly AnalysisFeatureDescriptor[], filePaths: readonly string[]): Record<string, number>;
/**
 * Compare an untrusted metadata value with the exact capabilities produced by
 * this build. Extra keys also mismatch: a rollback must rebuild instead of
 * certifying graph semantics emitted only by a newer binary.
 */
export declare function findAnalysisFeatureMismatches(actual: unknown, expected: AnalysisFeatureVersions): readonly string[];
