import { parseSpringAnnotationArguments, parseStaticStringValues } from './annotation-arguments.js';
export const SPRING_BEAN_ANNOTATION = 'org.springframework.context.annotation.Bean';
export const SPRING_BEAN_DECLARATION_ID_PREFIX = 'CodeElement:spring-bean:';
export const SPRING_BEAN_FACTORY_REASON_PREFIX = 'spring-bean-factory:';
function simpleName(name) {
    const separator = name.lastIndexOf('.');
    return separator === -1 ? name : name.slice(separator + 1);
}
export function hasSpringBeanFactorySyntax(annotations) {
    return annotations.some((annotation) => simpleName(annotation.name) === 'Bean');
}
/** Resolve statically readable Bean names; dynamic constants remain explicitly unknown. */
export function springBeanNames(annotationText, defaultMethodName) {
    const argumentsList = parseSpringAnnotationArguments(annotationText);
    if (argumentsList === null)
        return { names: [], namesKnown: false };
    const nameArguments = argumentsList.filter((argument) => argument.name === undefined || argument.name === 'name' || argument.name === 'value');
    if (nameArguments.length === 0)
        return { names: [defaultMethodName], namesKnown: true };
    const names = new Set();
    for (const argument of nameArguments) {
        const values = parseStaticStringValues(argument.value);
        if (values === null)
            return { names: [], namesKnown: false };
        for (const value of values) {
            if (value.length > 0)
                names.add(value);
        }
    }
    return {
        names: names.size === 0 ? [defaultMethodName] : [...names],
        namesKnown: true,
    };
}
export function encodeSpringBeanFactoryReason(declaration) {
    return `${SPRING_BEAN_FACTORY_REASON_PREFIX}${JSON.stringify(declaration)}`;
}
export function decodeSpringBeanFactoryReason(reason) {
    if (typeof reason !== 'string' || !reason.startsWith(SPRING_BEAN_FACTORY_REASON_PREFIX)) {
        return undefined;
    }
    try {
        const value = JSON.parse(reason.slice(SPRING_BEAN_FACTORY_REASON_PREFIX.length));
        if (!Array.isArray(value.names) ||
            !value.names.every((name) => typeof name === 'string') ||
            typeof value.namesKnown !== 'boolean' ||
            (value.providedType !== undefined && typeof value.providedType !== 'string')) {
            return undefined;
        }
        return {
            framework: 'spring',
            role: 'factory-method',
            annotation: SPRING_BEAN_ANNOTATION,
            names: value.names,
            ...(value.providedType === undefined ? {} : { providedType: value.providedType }),
        };
    }
    catch {
        return undefined;
    }
}
export function isSpringBeanFactoryDeclaration(relationship) {
    return (relationship.type === 'DECLARES' &&
        relationship.reason.startsWith(SPRING_BEAN_FACTORY_REASON_PREFIX));
}
