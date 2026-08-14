/**
 * TypeScript and JavaScript language providers.
 *
 * Both languages share the same type extraction config (typescriptConfig)
 * and export checker (tsExportChecker). They differ in file extensions, tree-sitter
 * queries (TypeScript grammar has interface/type nodes), and language ID.
 */
export declare const BUILT_INS: ReadonlySet<string>;
export declare const typescriptProvider: import("../language-provider.js").LanguageProvider;
export declare const javascriptProvider: import("../language-provider.js").LanguageProvider;
