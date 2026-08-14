import { type JvmPackageFact, type JvmPackageSyntaxNode } from '../jvm/package-facts.js';
export declare const clearJavaPackageFacts: () => void;
export declare const captureJavaPackageFact: (filePath: string, root: JvmPackageSyntaxNode) => void;
export declare const setJavaPackageFact: (filePath: string, fact: JvmPackageFact) => void;
export declare const getJavaPackageFact: (filePath: string) => JvmPackageFact | undefined;
