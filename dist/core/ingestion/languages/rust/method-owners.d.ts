import type { ParsedFile } from '../../../../_shared/index.js';
/**
 * Populate `ownerId` on Rust method defs.
 *
 * Rust methods are declared inside `impl TypeName { ... }` blocks, not
 * directly inside struct bodies. The tree-sitter query creates Class scopes
 * for impl blocks, and the generic `populateClassOwnedMembers` handles methods
 * that are structurally nested inside those Class scopes. But we also need to
 * bridge the impl block's methods to the actual struct def, since the impl
 * block is semantically "owned by" the struct.
 *
 * Strategy:
 * 1. Run the generic `populateClassOwnedMembers` (handles property fields in
 *    structs and methods in impl blocks).
 * 2. For each method in an impl block's Class scope whose ownerId points to
 *    the impl block, re-point ownerId to the struct def (if found in the
 *    same module).
 */
export declare function populateRustOwners(parsed: ParsedFile): void;
