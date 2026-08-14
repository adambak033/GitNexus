/**
 * Synthesize `@reference.call.free` captures for FastAPI `Depends(callable)`
 * parameter defaults.
 *
 * `Depends(get_db)` passes `get_db` as a callable that the DI framework
 * calls on every request. The route handler is functionally a caller of
 * the dependency — impact analysis needs that edge.
 *
 * Tree-sitter can't express "the first argument of a call named Depends
 * inside a parameter default" in a single static query, so we synthesize
 * reference captures in code, mirroring the receiver-binding pattern.
 */
import type { CaptureMatch } from '../../../../_shared/index.js';
import { type SyntaxNode } from '../../utils/ast-helpers.js';
/**
 * Inspect a `function_definition` node's parameters for `Depends(callable)`
 * defaults. Returns one `@reference.call.free` CaptureMatch per dependency.
 */
export declare function synthesizeDependsReferences(fnNode: SyntaxNode): readonly CaptureMatch[];
