import { createJvmPackageFactStore, } from '../jvm/package-facts.js';
const javaPackageFacts = createJvmPackageFactStore({
    packageNodeType: 'package_declaration',
    packageNameNodeTypes: ['scoped_identifier', 'identifier'],
});
export const clearJavaPackageFacts = () => javaPackageFacts.clear();
export const captureJavaPackageFact = (filePath, root) => javaPackageFacts.capture(filePath, root);
export const setJavaPackageFact = (filePath, fact) => javaPackageFacts.set(filePath, fact);
export const getJavaPackageFact = (filePath) => javaPackageFacts.get(filePath);
