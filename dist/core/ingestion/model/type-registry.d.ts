/**
 * Type Registry
 *
 * Class/struct/interface index extracted from SymbolTable.
 * Eagerly-populated indexes keyed by symbol name and qualified name.
 * Also includes a separate index for Rust Impl blocks.
 */
import type { SymbolDefinition } from '../../../_shared/index.js';
export interface TypeRegistry {
    /**
     * Look up class-like definitions (Class, Struct, Interface, Enum, Record, Trait)
     * by simple name. Returns all matching definitions across files
     * (e.g. partial classes). Returned array is a view into the live
     * internal index — do not mutate.
     */
    lookupClassByName(name: string): readonly SymbolDefinition[];
    /**
     * Look up class-like definitions by canonical qualified name.
     * Qualified names are normalized to dot-separated scope segments across languages,
     * e.g. `App.Models.User`, `com.example.User`, or `Admin.User`.
     * Returned array is a view into the live index — do not mutate.
     */
    lookupClassByQualifiedName(qualifiedName: string): readonly SymbolDefinition[];
    /**
     * Look up Impl nodes by name. Used by Tier 3 resolution to include Rust
     * impl blocks alongside class-like candidates.
     * Returned array is a view into the live index — do not mutate.
     */
    lookupImplByName(name: string): readonly SymbolDefinition[];
    /**
     * Look up nested-type defs registered under `(ownerNodeId, simpleName)`
     * in registration order. Returns `[]` on miss. Used by Step 2 Receiver/MRO
     * resolution when the receiver's owner declares nested classes/structs/
     * enums/typedefs/etc. that the caller's `acceptedKinds` includes.
     */
    lookupAllByOwner(ownerNodeId: string, simpleName: string): readonly SymbolDefinition[];
}
export interface MutableTypeRegistry extends TypeRegistry {
    /** Register a class-like type by name and qualified name. */
    registerClass(name: string, qualifiedName: string, def: SymbolDefinition): void;
    /** Register a Rust Impl block by name. */
    registerImpl(name: string, def: SymbolDefinition): void;
    /** Register a nested type under its owner. Appends when the key already exists. */
    registerByOwner(ownerNodeId: string, simpleName: string, def: SymbolDefinition): void;
    /** Clear all entries. */
    clear(): void;
}
export declare const createTypeRegistry: () => MutableTypeRegistry;
