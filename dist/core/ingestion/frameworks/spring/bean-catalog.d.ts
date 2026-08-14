export interface SpringBeanMetadata {
    framework: 'spring';
    role: string;
    annotation: string;
}
export interface SpringBeanStereotype {
    role: string;
}
export declare const SPRING_BEAN_STEREOTYPES: Map<string, SpringBeanStereotype>;
export declare function deriveSpringBeanMetadata(frameworkAnnotations: readonly string[]): SpringBeanMetadata | undefined;
/** Whether a source change can alter Spring Bean candidate metadata. */
export declare function isSpringBeanCandidateSourceFile(filePath: string): boolean;
