/**
 * Built-in Python taint model (#2204 first slice).
 *
 * Keep the model intentionally conservative: import-aware sinks for standard
 * library command execution, receiver-conventional database execution calls,
 * and Flask/FastAPI-style request-object member reads. No sanitizers are
 * registered yet because a false sanitizer kill can hide a real finding.
 */
import type { SourceSinkSanitizerSpec } from './source-sink-config.js';
export declare const PYTHON_TAINT_MODEL: SourceSinkSanitizerSpec;
