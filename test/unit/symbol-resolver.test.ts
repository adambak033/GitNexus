import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSymbol, resolveSymbolInternal } from '../../src/core/ingestion/symbol-resolver.js';
import { createSymbolTable } from '../../src/core/ingestion/symbol-table.js';
import { createImportMap, createPackageMap, isFileInPackageDir } from '../../src/core/ingestion/import-processor.js';
import type { ImportMap, PackageMap } from '../../src/core/ingestion/import-processor.js';

describe('resolveSymbol', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  describe('Tier 1: Same-file resolution', () => {
    it('resolves symbol defined in the same file', () => {
      symbolTable.add('src/models/user.ts', 'User', 'Class:src/models/user.ts:User', 'Class');

      const result = resolveSymbol('User', 'src/models/user.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/models/user.ts:User');
      expect(result!.filePath).toBe('src/models/user.ts');
      expect(result!.type).toBe('Class');
    });

    it('prefers same-file over imported definition', () => {
      symbolTable.add('src/local.ts', 'Config', 'Class:src/local.ts:Config', 'Class');
      symbolTable.add('src/shared.ts', 'Config', 'Class:src/shared.ts:Config', 'Class');
      importMap.set('src/local.ts', new Set(['src/shared.ts']));

      const result = resolveSymbol('Config', 'src/local.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/local.ts:Config');
      expect(result!.filePath).toBe('src/local.ts');
    });
  });

  describe('Tier 2: Import-scoped resolution', () => {
    it('resolves symbol from an imported file', () => {
      symbolTable.add('src/services/auth.ts', 'AuthService', 'Class:src/services/auth.ts:AuthService', 'Class');
      importMap.set('src/controllers/login.ts', new Set(['src/services/auth.ts']));

      const result = resolveSymbol('AuthService', 'src/controllers/login.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/services/auth.ts:AuthService');
      expect(result!.filePath).toBe('src/services/auth.ts');
    });

    it('prefers imported definition over non-imported with same name', () => {
      symbolTable.add('src/services/logger.ts', 'Logger', 'Class:src/services/logger.ts:Logger', 'Class');
      symbolTable.add('src/testing/mock-logger.ts', 'Logger', 'Class:src/testing/mock-logger.ts:Logger', 'Class');
      importMap.set('src/app.ts', new Set(['src/services/logger.ts']));

      const result = resolveSymbol('Logger', 'src/app.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/services/logger.ts:Logger');
      expect(result!.filePath).toBe('src/services/logger.ts');
    });

    it('handles file with no imports — unique global falls through', () => {
      symbolTable.add('src/utils.ts', 'Helper', 'Class:src/utils.ts:Helper', 'Class');

      const result = resolveSymbol('Helper', 'src/app.ts', symbolTable, importMap);

      // Falls through to Tier 3 (unique global)
      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/utils.ts:Helper');
    });
  });

  describe('Tier 3: Unique global resolution', () => {
    it('resolves unique global when not in imports', () => {
      symbolTable.add('src/external/base.ts', 'BaseModel', 'Class:src/external/base.ts:BaseModel', 'Class');
      importMap.set('src/app.ts', new Set(['src/other.ts']));

      const result = resolveSymbol('BaseModel', 'src/app.ts', symbolTable, importMap);

      expect(result).not.toBeNull();
      expect(result!.nodeId).toBe('Class:src/external/base.ts:BaseModel');
    });

    it('refuses ambiguous global — returns null when multiple candidates exist', () => {
      symbolTable.add('src/a.ts', 'Config', 'Class:src/a.ts:Config', 'Class');
      symbolTable.add('src/b.ts', 'Config', 'Class:src/b.ts:Config', 'Class');

      const result = resolveSymbol('Config', 'src/other.ts', symbolTable, importMap);

      // A wrong edge is worse than no edge
      expect(result).toBeNull();
    });
  });

  describe('null cases', () => {
    it('returns null for unknown symbol', () => {
      const result = resolveSymbol('NonExistent', 'src/app.ts', symbolTable, importMap);
      expect(result).toBeNull();
    });

    it('returns null when symbol table is empty', () => {
      const result = resolveSymbol('Anything', 'src/app.ts', symbolTable, importMap);
      expect(result).toBeNull();
    });
  });

  describe('type preservation', () => {
    it('preserves Interface type for heritage resolution', () => {
      symbolTable.add('src/interfaces.ts', 'ILogger', 'Interface:src/interfaces.ts:ILogger', 'Interface');
      importMap.set('src/app.ts', new Set(['src/interfaces.ts']));

      const result = resolveSymbol('ILogger', 'src/app.ts', symbolTable, importMap);

      expect(result!.type).toBe('Interface');
    });

    it('preserves Class type for heritage resolution', () => {
      symbolTable.add('src/base.ts', 'BaseService', 'Class:src/base.ts:BaseService', 'Class');
      importMap.set('src/app.ts', new Set(['src/base.ts']));

      const result = resolveSymbol('BaseService', 'src/app.ts', symbolTable, importMap);

      expect(result!.type).toBe('Class');
    });
  });

  describe('heritage-specific scenarios', () => {
    it('resolves C# interface vs class ambiguity via imports', () => {
      // ILogger exists as Interface in one file and Class in another
      symbolTable.add('src/logging/ilogger.cs', 'ILogger', 'Interface:src/logging/ilogger.cs:ILogger', 'Interface');
      symbolTable.add('src/testing/ilogger.cs', 'ILogger', 'Class:src/testing/ilogger.cs:ILogger', 'Class');
      importMap.set('src/services/auth.cs', new Set(['src/logging/ilogger.cs']));

      const result = resolveSymbol('ILogger', 'src/services/auth.cs', symbolTable, importMap);

      expect(result!.type).toBe('Interface');
      expect(result!.filePath).toBe('src/logging/ilogger.cs');
    });

    it('resolves parent class from imported file for extends', () => {
      symbolTable.add('src/api/controller.ts', 'UserController', 'Class:src/api/controller.ts:UserController', 'Class');
      symbolTable.add('src/base/controller.ts', 'BaseController', 'Class:src/base/controller.ts:BaseController', 'Class');
      importMap.set('src/api/controller.ts', new Set(['src/base/controller.ts']));

      const result = resolveSymbol('BaseController', 'src/api/controller.ts', symbolTable, importMap);

      expect(result!.nodeId).toBe('Class:src/base/controller.ts:BaseController');
    });
  });
});

describe('resolveSymbolInternal — tier metadata', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  it('returns same-file tier for Tier 1 match', () => {
    symbolTable.add('src/a.ts', 'Foo', 'Class:src/a.ts:Foo', 'Class');

    const result = resolveSymbolInternal('Foo', 'src/a.ts', symbolTable, importMap);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('same-file');
    expect(result!.candidateCount).toBe(1);
    expect(result!.definition.nodeId).toBe('Class:src/a.ts:Foo');
  });

  it('returns import-scoped tier for Tier 2 match', () => {
    symbolTable.add('src/logger.ts', 'Logger', 'Class:src/logger.ts:Logger', 'Class');
    symbolTable.add('src/mock.ts', 'Logger', 'Class:src/mock.ts:Logger', 'Class');
    importMap.set('src/app.ts', new Set(['src/logger.ts']));

    const result = resolveSymbolInternal('Logger', 'src/app.ts', symbolTable, importMap);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('import-scoped');
    expect(result!.candidateCount).toBe(2);
    expect(result!.definition.filePath).toBe('src/logger.ts');
  });

  it('returns unique-global tier for Tier 3 match', () => {
    symbolTable.add('src/only.ts', 'Singleton', 'Class:src/only.ts:Singleton', 'Class');

    const result = resolveSymbolInternal('Singleton', 'src/other.ts', symbolTable, importMap);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('unique-global');
    expect(result!.candidateCount).toBe(1);
  });

  it('returns null for ambiguous global — refuses to guess', () => {
    symbolTable.add('src/a.ts', 'Config', 'Class:src/a.ts:Config', 'Class');
    symbolTable.add('src/b.ts', 'Config', 'Class:src/b.ts:Config', 'Class');

    const result = resolveSymbolInternal('Config', 'src/other.ts', symbolTable, importMap);

    expect(result).toBeNull();
  });

  it('returns null for unknown symbol', () => {
    const result = resolveSymbolInternal('Ghost', 'src/any.ts', symbolTable, importMap);
    expect(result).toBeNull();
  });

  it('Tier 1 wins over Tier 2 — same-file takes priority', () => {
    symbolTable.add('src/app.ts', 'Util', 'Function:src/app.ts:Util', 'Function');
    symbolTable.add('src/lib.ts', 'Util', 'Function:src/lib.ts:Util', 'Function');
    importMap.set('src/app.ts', new Set(['src/lib.ts']));

    const result = resolveSymbolInternal('Util', 'src/app.ts', symbolTable, importMap);

    expect(result!.tier).toBe('same-file');
    expect(result!.definition.filePath).toBe('src/app.ts');
  });
});

describe('negative tests — ambiguous refusal per language family', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  it('TS/JS: two Logger definitions with no import → returns null', () => {
    symbolTable.add('src/services/logger.ts', 'Logger', 'Class:src/services/logger.ts:Logger', 'Class');
    symbolTable.add('src/testing/logger.ts', 'Logger', 'Class:src/testing/logger.ts:Logger', 'Class');

    const result = resolveSymbol('Logger', 'src/app.ts', symbolTable, importMap);
    expect(result).toBeNull();
  });

  it('Java: same-named class in different packages, no import → returns null', () => {
    symbolTable.add('com/example/models/User.java', 'User', 'Class:com/example/models/User.java:User', 'Class');
    symbolTable.add('com/example/dto/User.java', 'User', 'Class:com/example/dto/User.java:User', 'Class');

    const result = resolveSymbol('User', 'com/example/services/UserService.java', symbolTable, importMap);
    expect(result).toBeNull();
  });

  it('C/C++: type defined in transitively-included header → returns null (not reachable via direct import)', () => {
    // a.c includes b.h (direct), b.h includes c.h (transitive — not in ImportMap)
    symbolTable.add('src/c.h', 'Widget', 'Struct:src/c.h:Widget', 'Struct');
    symbolTable.add('src/d.h', 'Widget', 'Struct:src/d.h:Widget', 'Struct');
    importMap.set('src/a.c', new Set(['src/b.h']));

    const result = resolveSymbol('Widget', 'src/a.c', symbolTable, importMap);
    // Neither c.h nor d.h is directly imported → ambiguous global → null
    expect(result).toBeNull();
  });

  it('C#: two IService interfaces in different namespaces, no import → returns null', () => {
    symbolTable.add('src/Services/IService.cs', 'IService', 'Interface:src/Services/IService.cs:IService', 'Interface');
    symbolTable.add('src/Testing/IService.cs', 'IService', 'Interface:src/Testing/IService.cs:IService', 'Interface');

    const result = resolveSymbol('IService', 'src/App.cs', symbolTable, importMap);
    expect(result).toBeNull();
  });
});

describe('heritage false-positive guard', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  it('null from resolveSymbol prevents false edge — generateId fallback produces synthetic ID, not wrong match', () => {
    // Two BaseController in different files — ambiguous
    symbolTable.add('src/api/base.ts', 'BaseController', 'Class:src/api/base.ts:BaseController', 'Class');
    symbolTable.add('src/testing/base.ts', 'BaseController', 'Class:src/testing/base.ts:BaseController', 'Class');

    // resolveSymbol returns null — heritage-processor would use generateId fallback
    const result = resolveSymbol('BaseController', 'src/routes/admin.ts', symbolTable, importMap);
    expect(result).toBeNull();

    // Verify: with import, it resolves correctly to the right one
    importMap.set('src/routes/admin.ts', new Set(['src/api/base.ts']));
    const resolved = resolveSymbol('BaseController', 'src/routes/admin.ts', symbolTable, importMap);
    expect(resolved).not.toBeNull();
    expect(resolved!.filePath).toBe('src/api/base.ts');
  });
});

describe('lookupExactFull', () => {
  it('returns full SymbolDefinition for same-file lookup via O(1) direct storage', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/models/user.ts', 'User', 'Class:src/models/user.ts:User', 'Class');

    const result = symbolTable.lookupExactFull('src/models/user.ts', 'User');

    expect(result).not.toBeUndefined();
    expect(result!.nodeId).toBe('Class:src/models/user.ts:User');
    expect(result!.filePath).toBe('src/models/user.ts');
    expect(result!.type).toBe('Class');
  });

  it('returns undefined for non-existent symbol', () => {
    const symbolTable = createSymbolTable();
    const result = symbolTable.lookupExactFull('src/app.ts', 'NonExistent');
    expect(result).toBeUndefined();
  });

  it('returns undefined for wrong file', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/a.ts', 'Foo', 'Class:src/a.ts:Foo', 'Class');

    const result = symbolTable.lookupExactFull('src/b.ts', 'Foo');
    expect(result).toBeUndefined();
  });

  it('shares same object reference between fileIndex and globalIndex', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/x.ts', 'Bar', 'Class:src/x.ts:Bar', 'Class');

    const fromExact = symbolTable.lookupExactFull('src/x.ts', 'Bar');
    const fromFuzzy = symbolTable.lookupFuzzy('Bar')[0];

    // Same object reference — zero additional memory
    expect(fromExact).toBe(fromFuzzy);
  });

  it('preserves optional callable metadata on stored definitions', () => {
    const symbolTable = createSymbolTable();
    symbolTable.add('src/math.ts', 'sum', 'Function:src/math.ts:sum', 'Function', { parameterCount: 2 });

    const fromExact = symbolTable.lookupExactFull('src/math.ts', 'sum');
    const fromFuzzy = symbolTable.lookupFuzzy('sum')[0];

    expect(fromExact?.parameterCount).toBe(2);
    expect(fromFuzzy.parameterCount).toBe(2);
    expect(fromExact).toBe(fromFuzzy);
  });
});

describe('isFileInPackageDir', () => {
  it('matches file directly in the package directory', () => {
    expect(isFileInPackageDir('internal/auth/handler.go', '/internal/auth/')).toBe(true);
  });

  it('matches with leading path segments', () => {
    expect(isFileInPackageDir('myrepo/internal/auth/handler.go', '/internal/auth/')).toBe(true);
    expect(isFileInPackageDir('src/github.com/user/repo/internal/auth/handler.go', '/internal/auth/')).toBe(true);
  });

  it('rejects files in subdirectories', () => {
    expect(isFileInPackageDir('internal/auth/middleware/jwt.go', '/internal/auth/')).toBe(false);
  });

  it('matches any file extension in the directory', () => {
    expect(isFileInPackageDir('internal/auth/README.md', '/internal/auth/')).toBe(true);
    expect(isFileInPackageDir('Models/User.cs', '/Models/')).toBe(true);
    expect(isFileInPackageDir('internal/auth/handler_test.go', '/internal/auth/')).toBe(true);
  });

  it('rejects files not in the package', () => {
    expect(isFileInPackageDir('internal/db/connection.go', '/internal/auth/')).toBe(false);
  });

  it('handles backslash paths (Windows)', () => {
    expect(isFileInPackageDir('internal\\auth\\handler.go', '/internal/auth/')).toBe(true);
  });

  it('matches C# namespace directories', () => {
    expect(isFileInPackageDir('MyProject/Models/User.cs', '/MyProject/Models/')).toBe(true);
    expect(isFileInPackageDir('MyProject/Models/Order.cs', '/MyProject/Models/')).toBe(true);
    expect(isFileInPackageDir('MyProject/Models/Sub/Nested.cs', '/MyProject/Models/')).toBe(false);
  });
});

describe('Tier 2b: PackageMap resolution (Go)', () => {
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;
  let packageMap: PackageMap;

  beforeEach(() => {
    symbolTable = createSymbolTable();
    importMap = createImportMap();
    packageMap = createPackageMap();
  });

  it('resolves symbol via PackageMap when not in ImportMap', () => {
    symbolTable.add('internal/auth/handler.go', 'HandleLogin', 'Function:internal/auth/handler.go:HandleLogin', 'Function');
    // No ImportMap entry — but PackageMap has the package directory
    packageMap.set('cmd/server/main.go', new Set(['/internal/auth/']));

    const result = resolveSymbolInternal('HandleLogin', 'cmd/server/main.go', symbolTable, importMap, packageMap);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('import-scoped');
    expect(result!.definition.filePath).toBe('internal/auth/handler.go');
  });

  it('does not resolve symbol from wrong package', () => {
    symbolTable.add('internal/db/connection.go', 'Connect', 'Function:internal/db/connection.go:Connect', 'Function');
    packageMap.set('cmd/server/main.go', new Set(['/internal/auth/']));

    const result = resolveSymbolInternal('Connect', 'cmd/server/main.go', symbolTable, importMap, packageMap);

    // Not in imported package, and not unique global (only 1 def) → unique-global
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('unique-global');
  });

  it('Tier 2a (ImportMap) takes precedence over Tier 2b (PackageMap)', () => {
    symbolTable.add('internal/auth/handler.go', 'Validate', 'Function:internal/auth/handler.go:Validate', 'Function');
    symbolTable.add('internal/db/validator.go', 'Validate', 'Function:internal/db/validator.go:Validate', 'Function');

    // ImportMap points to db, PackageMap points to auth
    importMap.set('cmd/server/main.go', new Set(['internal/db/validator.go']));
    packageMap.set('cmd/server/main.go', new Set(['/internal/auth/']));

    const result = resolveSymbolInternal('Validate', 'cmd/server/main.go', symbolTable, importMap, packageMap);

    expect(result).not.toBeNull();
    expect(result!.tier).toBe('import-scoped');
    expect(result!.definition.filePath).toBe('internal/db/validator.go');
  });

  it('resolves both symbols in same imported package (first match wins)', () => {
    symbolTable.add('internal/auth/handler.go', 'Run', 'Function:internal/auth/handler.go:Run', 'Function');
    symbolTable.add('internal/auth/worker.go', 'Run', 'Function:internal/auth/worker.go:Run', 'Function');
    packageMap.set('cmd/main.go', new Set(['/internal/auth/']));

    const result = resolveSymbolInternal('Run', 'cmd/main.go', symbolTable, importMap, packageMap);

    // Both match the package — returns first match as import-scoped
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('import-scoped');
  });

  it('returns null without packageMap (backward compat)', () => {
    symbolTable.add('internal/auth/handler.go', 'X', 'Function:internal/auth/handler.go:X', 'Function');
    symbolTable.add('internal/db/handler.go', 'X', 'Function:internal/db/handler.go:X', 'Function');

    // No importMap entry, no packageMap → ambiguous
    const result = resolveSymbolInternal('X', 'cmd/main.go', symbolTable, importMap);

    expect(result).toBeNull();
  });
});
