import { createJvmPackageFactStore, } from '../jvm/package-facts.js';
const kotlinPackageFacts = createJvmPackageFactStore({
    packageNodeType: 'package_header',
    packageNameNodeTypes: ['identifier'],
});
export const clearKotlinPackageFacts = () => kotlinPackageFacts.clear();
export const captureKotlinPackageFact = (filePath, root) => kotlinPackageFacts.capture(filePath, root);
export const setKotlinPackageFact = (filePath, fact) => kotlinPackageFacts.set(filePath, fact);
export const getKotlinPackageFact = (filePath) => kotlinPackageFacts.get(filePath);
