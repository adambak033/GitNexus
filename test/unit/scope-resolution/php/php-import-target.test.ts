import type { ParsedFile, ParsedImport, SymbolDefinition } from 'gitnexus-shared';
import { describe, expect, it } from 'vitest';

import type { ComposerConfig } from '../../../../src/core/ingestion/language-config.js';
import { resolvePhpImportTargetInternal } from '../../../../src/core/ingestion/languages/php/import-target.js';

const composerConfig: ComposerConfig = { psr4: new Map([['App', 'app']]) };

function parsedFile(filePath: string, definitions: readonly SymbolDefinition[]): ParsedFile {
  return { filePath, localDefs: definitions } as ParsedFile;
}

function definition(
  filePath: string,
  type: SymbolDefinition['type'],
  name: string,
): SymbolDefinition {
  return {
    nodeId: `def:${filePath}:${type}:${name}`,
    filePath,
    type,
    qualifiedName: name,
  };
}

const functionImport: ParsedImport = {
  kind: 'named',
  localName: 'getUser',
  importedName: 'getUser',
  targetRaw: 'App\\Models\\getUser',
  importedSymbolKind: 'function',
};

describe('resolvePhpImportTargetInternal declaration selection', () => {
  it('finds a unique function declaration when the symbol name is not a filename', () => {
    const user = '/repo/app/Models/User.php';
    const factory = '/repo/app/Models/UserFactory.php';
    const parsedFiles = [
      parsedFile(user, [definition(user, 'Class', 'User')]),
      parsedFile(factory, [definition(factory, 'Function', 'getUser')]),
    ];

    expect(
      resolvePhpImportTargetInternal(
        functionImport.targetRaw,
        '/repo/app/Main.php',
        new Set(parsedFiles.map((parsed) => parsed.filePath)),
        composerConfig,
        { parsedFiles, parsedImport: functionImport },
      ),
    ).toBe(factory);
  });

  it('reuses directory selection without leaking candidates across namespaces', () => {
    const models = '/repo/app/Models/functions.php';
    const services = '/repo/app/Services/functions.php';
    const parsedFiles = [
      parsedFile(models, [definition(models, 'Function', 'getUser')]),
      parsedFile(services, [definition(services, 'Function', 'getUser')]),
    ];

    const first = resolvePhpImportTargetInternal(
      functionImport.targetRaw,
      '/repo/app/Main.php',
      new Set(parsedFiles.map((parsed) => parsed.filePath)),
      composerConfig,
      { parsedFiles, parsedImport: functionImport },
    );
    const second = resolvePhpImportTargetInternal(
      functionImport.targetRaw,
      '/repo/app/Main.php',
      new Set(parsedFiles.map((parsed) => parsed.filePath)),
      composerConfig,
      { parsedFiles, parsedImport: functionImport },
    );

    expect(first).toBe(models);
    expect(second).toBe(models);
  });

  it('fails closed when the namespace has duplicate function declarations', () => {
    const first = '/repo/app/Models/First.php';
    const second = '/repo/app/Models/Second.php';
    const parsedFiles = [
      parsedFile(first, [definition(first, 'Function', 'getUser')]),
      parsedFile(second, [definition(second, 'Function', 'getUser')]),
    ];

    expect(
      resolvePhpImportTargetInternal(
        functionImport.targetRaw,
        '/repo/app/Main.php',
        new Set(parsedFiles.map((parsed) => parsed.filePath)),
        composerConfig,
        { parsedFiles, parsedImport: functionImport },
      ),
    ).toBeNull();
  });

  it('resolves a constant only when its namespace directory has one candidate file', () => {
    const constants = '/repo/app/Config/constants.php';
    const parsedFiles = [parsedFile(constants, [])];
    const parsedImport: ParsedImport = {
      kind: 'named',
      localName: 'MAX_RETRIES',
      importedName: 'MAX_RETRIES',
      targetRaw: 'App\\Config\\MAX_RETRIES',
      importedSymbolKind: 'const',
    };

    expect(
      resolvePhpImportTargetInternal(
        parsedImport.targetRaw,
        '/repo/app/Main.php',
        new Set([constants]),
        composerConfig,
        { parsedFiles, parsedImport },
      ),
    ).toBe(constants);
  });
});
