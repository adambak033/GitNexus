export interface SymbolDefinition {
  nodeId: string;
  filePath: string;
  type: string; // 'Function', 'Class', etc.
  parameterCount?: number;
  /** Raw return type text extracted from AST (e.g. 'User', 'Promise<User>') */
  returnType?: string;
  /** Links Method/Constructor to owning Class/Struct/Trait nodeId */
  ownerId?: string;
}

export interface SymbolTable {
  /**
   * Register a new symbol definition
   */
  add: (
    filePath: string,
    name: string,
    nodeId: string,
    type: string,
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string }
  ) => void;
  
  /**
   * High Confidence: Look for a symbol specifically inside a file
   * Returns the Node ID if found
   */
  lookupExact: (filePath: string, name: string) => string | undefined;
  
  /**
   * High Confidence: Look for a symbol in a specific file, returning full definition.
   * Includes type information needed for heritage resolution (Class vs Interface).
   */
  lookupExactFull: (filePath: string, name: string) => SymbolDefinition | undefined;

  /**
   * Low Confidence: Look for a symbol anywhere in the project
   * Used when imports are missing or for framework magic
   */
  lookupFuzzy: (name: string) => SymbolDefinition[];

  /**
   * Low Confidence: Look for callable symbols (Function/Method/Constructor) by name.
   * Faster than `lookupFuzzy` + filter — backed by a lazy callable-only index.
   * Used by ReturnTypeLookup to resolve callee → return type.
   */
  lookupFuzzyCallable: (name: string) => SymbolDefinition[];
  
  /**
   * Debugging: See how many symbols are tracked
   */
  getStats: () => { fileCount: number; globalSymbolCount: number };
  
  /**
   * Cleanup memory
   */
  clear: () => void;
}

export const createSymbolTable = (): SymbolTable => {
  // 1. File-Specific Index — stores full SymbolDefinition for O(1) lookupExactFull
  // Structure: FilePath -> (SymbolName -> SymbolDefinition)
  const fileIndex = new Map<string, Map<string, SymbolDefinition>>();

  // 2. Global Reverse Index (The "Backup")
  // Structure: SymbolName -> [List of Definitions]
  const globalIndex = new Map<string, SymbolDefinition[]>();

  // 3. Lazy Callable Index — populated on first lookupFuzzyCallable call.
  // Structure: SymbolName -> [Callable Definitions]
  // Only Function, Method, Constructor symbols are indexed.
  let callableIndex: Map<string, SymbolDefinition[]> | null = null;

  const CALLABLE_TYPES = new Set(['Function', 'Method', 'Constructor']);

  const add = (
    filePath: string,
    name: string,
    nodeId: string,
    type: string,
    metadata?: { parameterCount?: number; returnType?: string; ownerId?: string }
  ) => {
    const def: SymbolDefinition = {
      nodeId,
      filePath,
      type,
      ...(metadata?.parameterCount !== undefined ? { parameterCount: metadata.parameterCount } : {}),
      ...(metadata?.returnType !== undefined ? { returnType: metadata.returnType } : {}),
      ...(metadata?.ownerId !== undefined ? { ownerId: metadata.ownerId } : {}),
    };

    // A. Add to File Index (shared reference — zero additional memory)
    if (!fileIndex.has(filePath)) {
      fileIndex.set(filePath, new Map());
    }
    fileIndex.get(filePath)!.set(name, def);

    // B. Add to Global Index (same object reference)
    if (!globalIndex.has(name)) {
      globalIndex.set(name, []);
    }
    globalIndex.get(name)!.push(def);

    // Invalidate the lazy callable index — it will be rebuilt on next use
    callableIndex = null;
  };

  const lookupExact = (filePath: string, name: string): string | undefined => {
    return fileIndex.get(filePath)?.get(name)?.nodeId;
  };

  const lookupExactFull = (filePath: string, name: string): SymbolDefinition | undefined => {
    return fileIndex.get(filePath)?.get(name);
  };

  const lookupFuzzy = (name: string): SymbolDefinition[] => {
    return globalIndex.get(name) || [];
  };

  const lookupFuzzyCallable = (name: string): SymbolDefinition[] => {
    if (!callableIndex) {
      // Build the callable index lazily on first use
      callableIndex = new Map();
      for (const [symName, defs] of globalIndex) {
        const callables = defs.filter(d => CALLABLE_TYPES.has(d.type));
        if (callables.length > 0) callableIndex.set(symName, callables);
      }
    }
    return callableIndex.get(name) ?? [];
  };

  const getStats = () => ({
    fileCount: fileIndex.size,
    globalSymbolCount: globalIndex.size
  });

  const clear = () => {
    fileIndex.clear();
    globalIndex.clear();
    callableIndex = null;
  };

  return { add, lookupExact, lookupExactFull, lookupFuzzy, lookupFuzzyCallable, getStats, clear };
};
