/**
 * JVM import resolution — internal helpers (Java + Kotlin).
 *
 * Strategies live in configs/jvm.ts.
 * This file contains shared helpers for wildcard/member resolution
 * and the Kotlin wildcard preprocessor.
 */
import type { SuffixIndex } from './utils.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';
/** Kotlin file extensions for JVM resolver reuse */
export declare const KOTLIN_EXTENSIONS: readonly string[];
/**
 * Append .* to a Kotlin import path if the AST has a wildcard_import sibling node.
 * Pure function — returns a new string without mutating the input.
 */
export declare const appendKotlinWildcard: (importPath: string, importNode: SyntaxNode) => string;
/**
 * Resolve a JVM wildcard import (com.example.*) to all matching files.
 * Works for both Java (.java) and Kotlin (.kt, .kts).
 */
export declare function resolveJvmWildcard(importPath: string, normalizedFileList: readonly string[], allFileList: readonly string[], extensions: readonly string[], index?: SuffixIndex): string[];
/**
 * Try to resolve a JVM member/static import by stripping the member name.
 * Java: "com.example.Constants.VALUE" -> resolve "com.example.Constants"
 * Kotlin: "com.example.Constants.VALUE" -> resolve "com.example.Constants"
 */
export declare function resolveJvmMemberImport(importPath: string, normalizedFileList: readonly string[], allFileList: readonly string[], extensions: readonly string[], index?: SuffixIndex): string | null;
