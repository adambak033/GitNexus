/**
 * Supported language enum — single source of truth.
 *
 * Both CLI and web use this to identify which language a file/node belongs to.
 * The CLI uses it throughout the ingestion pipeline; the web uses it for display.
 */
export var SupportedLanguages;
(function (SupportedLanguages) {
    SupportedLanguages["JavaScript"] = "javascript";
    SupportedLanguages["TypeScript"] = "typescript";
    SupportedLanguages["Python"] = "python";
    SupportedLanguages["Java"] = "java";
    SupportedLanguages["C"] = "c";
    SupportedLanguages["CPlusPlus"] = "cpp";
    SupportedLanguages["CSharp"] = "csharp";
    SupportedLanguages["Go"] = "go";
    SupportedLanguages["Ruby"] = "ruby";
    SupportedLanguages["Rust"] = "rust";
    SupportedLanguages["PHP"] = "php";
    SupportedLanguages["Kotlin"] = "kotlin";
    SupportedLanguages["Swift"] = "swift";
    SupportedLanguages["Dart"] = "dart";
    SupportedLanguages["Vue"] = "vue";
    /** Standalone regex processor — no tree-sitter, no LanguageProvider. */
    SupportedLanguages["Cobol"] = "cobol";
})(SupportedLanguages || (SupportedLanguages = {}));
//# sourceMappingURL=languages.js.map