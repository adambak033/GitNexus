import { type JvmPackageFact, type JvmPackageSyntaxNode } from '../jvm/package-facts.js';
export declare const clearKotlinPackageFacts: () => void;
export declare const captureKotlinPackageFact: (filePath: string, root: JvmPackageSyntaxNode) => void;
export declare const setKotlinPackageFact: (filePath: string, fact: JvmPackageFact) => void;
export declare const getKotlinPackageFact: (filePath: string) => JvmPackageFact | undefined;
