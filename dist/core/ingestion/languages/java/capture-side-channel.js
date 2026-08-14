import { createClassAnnotationFactStore, } from '../../frameworks/spring/bean-candidates.js';
import { isJvmPackageFact, UNKNOWN_JVM_PACKAGE_FACT, } from '../jvm/package-facts.js';
import { getJavaPackageFact, setJavaPackageFact } from './package-facts.js';
const classAnnotations = createClassAnnotationFactStore();
const springAopFacts = new Map();
const springConfigConsumers = new Map();
const springConditionalFacts = new Map();
const springDiFacts = new Map();
/** Clear facts retained by a prior workspace pass in a long-lived process. */
export function clearJavaClassAnnotationFacts() {
    classAnnotations.clear();
    springAopFacts.clear();
    springConfigConsumers.clear();
    springConditionalFacts.clear();
    springDiFacts.clear();
}
export function setJavaSpringAopFacts(filePath, facts) {
    if (facts.length === 0)
        springAopFacts.delete(filePath);
    else
        springAopFacts.set(filePath, facts);
}
export function getJavaSpringAopFacts(filePath) {
    return springAopFacts.get(filePath) ?? [];
}
/** Store the annotation syntax collected by Java's existing scope-query traversal. */
export function setJavaClassAnnotationFacts(filePath, facts) {
    classAnnotations.set(filePath, facts);
}
export function setJavaSpringConfigConsumerFacts(filePath, facts) {
    if (facts.length === 0)
        springConfigConsumers.delete(filePath);
    else
        springConfigConsumers.set(filePath, facts);
}
export function getJavaSpringConfigConsumerFacts(filePath) {
    return springConfigConsumers.get(filePath) ?? [];
}
export function setJavaSpringConditionalFacts(filePath, facts) {
    if (facts.length === 0)
        springConditionalFacts.delete(filePath);
    else
        springConditionalFacts.set(filePath, facts);
}
export function getJavaSpringConditionalFacts(filePath) {
    return springConditionalFacts.get(filePath) ?? [];
}
export function setJavaSpringDiFacts(filePath, facts) {
    if (facts.length === 0)
        springDiFacts.delete(filePath);
    else
        springDiFacts.set(filePath, facts);
}
export function getJavaSpringDiFacts(filePath) {
    return springDiFacts.get(filePath) ?? [];
}
/** Snapshot worker-local Java annotation facts for ParsedFile serialization. */
export function collectJavaCaptureSideChannel(filePath) {
    const facts = classAnnotations.get(filePath);
    const aopFacts = springAopFacts.get(filePath) ?? [];
    const configConsumers = springConfigConsumers.get(filePath) ?? [];
    const conditionFacts = springConditionalFacts.get(filePath) ?? [];
    const diFacts = springDiFacts.get(filePath) ?? [];
    const packageFact = getJavaPackageFact(filePath);
    if (facts.length === 0 &&
        aopFacts.length === 0 &&
        configConsumers.length === 0 &&
        conditionFacts.length === 0 &&
        diFacts.length === 0 &&
        packageFact === undefined) {
        return undefined;
    }
    return {
        kind: 'java',
        packageFact: packageFact ?? UNKNOWN_JVM_PACKAGE_FACT,
        classAnnotations: facts,
        ...(aopFacts.length > 0 ? { springAopFacts: aopFacts } : {}),
        ...(configConsumers.length > 0 ? { springConfigConsumers: configConsumers } : {}),
        ...(conditionFacts.length > 0 ? { springConditionalFacts: conditionFacts } : {}),
        ...(diFacts.length > 0 ? { springDiFacts: diFacts } : {}),
    };
}
export function getJavaClassAnnotationFacts(filePath) {
    return classAnnotations.get(filePath);
}
/** Restore worker-collected facts before Java's post-resolution hook runs. */
export function applyJavaCaptureSideChannel(parsed) {
    const data = parsed.captureSideChannel;
    if (data === undefined ||
        data === null ||
        typeof data !== 'object' ||
        data.kind !== 'java' ||
        !Array.isArray(data.classAnnotations)) {
        setJavaClassAnnotationFacts(parsed.filePath, []);
        setJavaSpringAopFacts(parsed.filePath, []);
        setJavaSpringConfigConsumerFacts(parsed.filePath, []);
        setJavaSpringConditionalFacts(parsed.filePath, []);
        setJavaSpringDiFacts(parsed.filePath, []);
        setJavaPackageFact(parsed.filePath, UNKNOWN_JVM_PACKAGE_FACT);
        return;
    }
    setJavaClassAnnotationFacts(parsed.filePath, data.classAnnotations);
    setJavaSpringAopFacts(parsed.filePath, Array.isArray(data.springAopFacts) ? data.springAopFacts : []);
    setJavaSpringConfigConsumerFacts(parsed.filePath, Array.isArray(data.springConfigConsumers) ? data.springConfigConsumers : []);
    setJavaSpringConditionalFacts(parsed.filePath, Array.isArray(data.springConditionalFacts) ? data.springConditionalFacts : []);
    setJavaSpringDiFacts(parsed.filePath, Array.isArray(data.springDiFacts) ? data.springDiFacts : []);
    setJavaPackageFact(parsed.filePath, isJvmPackageFact(data.packageFact) ? data.packageFact : UNKNOWN_JVM_PACKAGE_FACT);
}
