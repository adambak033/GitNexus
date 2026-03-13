import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processHeritageFromExtracted } from '../../src/core/ingestion/heritage-processor.js';
import { createSymbolTable } from '../../src/core/ingestion/symbol-table.js';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import { createImportMap } from '../../src/core/ingestion/import-processor.js';
import type { ImportMap } from '../../src/core/ingestion/import-processor.js';
import type { ExtractedHeritage } from '../../src/core/ingestion/workers/parse-worker.js';

describe('processHeritageFromExtracted', () => {
  let graph: ReturnType<typeof createKnowledgeGraph>;
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    graph = createKnowledgeGraph();
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  describe('extends', () => {
    it('creates EXTENDS relationship between classes', async () => {
      symbolTable.add('src/admin.ts', 'AdminUser', 'Class:src/admin.ts:AdminUser', 'Class');
      symbolTable.add('src/user.ts', 'User', 'Class:src/user.ts:User', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/admin.ts',
        className: 'AdminUser',
        parentName: 'User',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const rels = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toBe('Class:src/admin.ts:AdminUser');
      expect(rels[0].targetId).toBe('Class:src/user.ts:User');
      expect(rels[0].confidence).toBe(1.0);
    });

    it('uses generated ID when class not in symbol table', async () => {
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/admin.ts',
        className: 'AdminUser',
        parentName: 'BaseUser',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const rels = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toContain('AdminUser');
      expect(rels[0].targetId).toContain('BaseUser');
    });

    it('skips self-inheritance', async () => {
      symbolTable.add('src/a.ts', 'Foo', 'Class:src/a.ts:Foo', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/a.ts',
        className: 'Foo',
        parentName: 'Foo',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);
      expect(graph.relationshipCount).toBe(0);
    });
  });

  describe('implements', () => {
    it('creates IMPLEMENTS relationship', async () => {
      symbolTable.add('src/service.ts', 'UserService', 'Class:src/service.ts:UserService', 'Class');
      symbolTable.add('src/interfaces.ts', 'IService', 'Interface:src/interfaces.ts:IService', 'Interface');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/service.ts',
        className: 'UserService',
        parentName: 'IService',
        kind: 'implements',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const rels = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toBe('Class:src/service.ts:UserService');
    });
  });

  describe('trait-impl (Rust)', () => {
    it('creates IMPLEMENTS relationship for trait impl', async () => {
      symbolTable.add('src/point.rs', 'Point', 'Struct:src/point.rs:Point', 'Struct');
      symbolTable.add('src/display.rs', 'Display', 'Trait:src/display.rs:Display', 'Trait');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/point.rs',
        className: 'Point',
        parentName: 'Display',
        kind: 'trait-impl',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const rels = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(rels).toHaveLength(1);
      expect(rels[0].reason).toBe('trait-impl');
    });
  });

  describe('C# interface resolution from extends captures', () => {
    it('emits IMPLEMENTS when parent is an Interface in symbol table', async () => {
      symbolTable.add('src/Service.cs', 'UserService', 'Class:src/Service.cs:UserService', 'Class');
      symbolTable.add('src/IService.cs', 'IService', 'Interface:src/IService.cs:IService', 'Interface');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Service.cs',
        className: 'UserService',
        parentName: 'IService',
        kind: 'extends', // C# base_list always sends extends
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(impls).toHaveLength(1);
      expect(exts).toHaveLength(0);
      expect(impls[0].sourceId).toBe('Class:src/Service.cs:UserService');
      expect(impls[0].targetId).toBe('Interface:src/IService.cs:IService');
    });

    it('emits EXTENDS when parent is a Class in symbol table', async () => {
      symbolTable.add('src/Admin.cs', 'AdminUser', 'Class:src/Admin.cs:AdminUser', 'Class');
      symbolTable.add('src/User.cs', 'User', 'Class:src/User.cs:User', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Admin.cs',
        className: 'AdminUser',
        parentName: 'User',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(exts).toHaveLength(1);
      expect(impls).toHaveLength(0);
    });

    it('uses I[A-Z] heuristic for unresolved interface names in C#', async () => {
      // IDisposable is not in symbol table (external .NET type)
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Resource.cs',
        className: 'Resource',
        parentName: 'IDisposable',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(impls).toHaveLength(1);
      expect(impls[0].targetId).toContain('IDisposable');
    });

    it('does not apply I[A-Z] heuristic for TypeScript — unresolved IFoo should be EXTENDS', async () => {
      // The I[A-Z] convention is C#/Java-specific; TypeScript files should not be affected
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/service.ts',
        className: 'MyService',
        parentName: 'IFoo',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(exts).toHaveLength(1);
      expect(impls).toHaveLength(0);
    });

    it('does not misclassify non-I-prefixed unresolved names as interfaces', async () => {
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Derived.cs',
        className: 'Derived',
        parentName: 'BaseClass',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(exts).toHaveLength(1);
      expect(impls).toHaveLength(0);
    });

    it('does not match single-letter I names like "I" or "Id"', async () => {
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Thing.cs',
        className: 'Thing',
        parentName: 'Id',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      // "Id" starts with I but second char is lowercase — should be EXTENDS
      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(exts).toHaveLength(1);
    });

    it('handles mixed class + interface base_list from C#', async () => {
      symbolTable.add('src/Repo.cs', 'UserRepo', 'Class:src/Repo.cs:UserRepo', 'Class');
      symbolTable.add('src/Base.cs', 'BaseRepository', 'Class:src/Base.cs:BaseRepository', 'Class');
      symbolTable.add('src/IRepo.cs', 'IRepository', 'Interface:src/IRepo.cs:IRepository', 'Interface');
      symbolTable.add('src/IDisp.cs', 'IDisposable', 'Interface:src/IDisp.cs:IDisposable', 'Interface');

      const heritage: ExtractedHeritage[] = [
        { filePath: 'src/Repo.cs', className: 'UserRepo', parentName: 'BaseRepository', kind: 'extends' },
        { filePath: 'src/Repo.cs', className: 'UserRepo', parentName: 'IRepository', kind: 'extends' },
        { filePath: 'src/Repo.cs', className: 'UserRepo', parentName: 'IDisposable', kind: 'extends' },
      ];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(exts).toHaveLength(1); // BaseRepository
      expect(impls).toHaveLength(2); // IRepository + IDisposable
    });
  });

  describe('Swift protocol conformance from extends captures', () => {
    it('defaults unresolved PascalCase protocol names to IMPLEMENTS for Swift', async () => {
      // Codable, Hashable, Equatable etc. are protocols — no I-prefix convention in Swift
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Model.swift',
        className: 'User',
        parentName: 'Codable',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(impls).toHaveLength(1);
      expect(exts).toHaveLength(0);
      expect(impls[0].targetId).toContain('Codable');
    });

    it('still uses symbol table authoritatively for Swift (Tier 1 takes precedence)', async () => {
      // When the parent is in the symbol table as a Class, EXTENDS wins even in Swift
      symbolTable.add('src/Animal.swift', 'Animal', 'Class:src/Animal.swift:Animal', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/Dog.swift',
        className: 'Dog',
        parentName: 'Animal',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);

      const exts = graph.relationships.filter(r => r.type === 'EXTENDS');
      const impls = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(exts).toHaveLength(1);
      expect(impls).toHaveLength(0);
    });
  });

  it('handles multiple heritage entries', async () => {
    const heritage: ExtractedHeritage[] = [
      { filePath: 'src/a.ts', className: 'A', parentName: 'B', kind: 'extends' },
      { filePath: 'src/c.ts', className: 'C', parentName: 'D', kind: 'implements' },
      { filePath: 'src/e.rs', className: 'E', parentName: 'F', kind: 'trait-impl' },
    ];

    await processHeritageFromExtracted(graph, heritage, symbolTable, importMap);
    expect(graph.relationships.filter(r => r.type === 'EXTENDS')).toHaveLength(1);
    expect(graph.relationships.filter(r => r.type === 'IMPLEMENTS')).toHaveLength(2);
  });

  it('calls progress callback', async () => {
    const heritage: ExtractedHeritage[] = [
      { filePath: 'src/a.ts', className: 'A', parentName: 'B', kind: 'extends' },
    ];

    const onProgress = vi.fn();
    await processHeritageFromExtracted(graph, heritage, symbolTable, importMap, undefined, onProgress);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it('handles empty heritage array', async () => {
    await processHeritageFromExtracted(graph, [], symbolTable, importMap);
    expect(graph.relationshipCount).toBe(0);
  });
});
