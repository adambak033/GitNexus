export interface SpringAnnotationArgument {
    readonly name?: string;
    readonly value: string;
}
/** Parse Java/Kotlin annotation arguments without evaluating constants. */
export declare function parseSpringAnnotationArguments(annotationText: string): readonly SpringAnnotationArgument[] | null;
export declare function parseStaticStringLiteral(value: string): string | null;
/** Parse one string literal or a Java/Kotlin annotation string array. */
export declare function parseStaticStringValues(value: string): readonly string[] | null;
/** Parse `Foo.class` or `Foo::class`; an Object/Any default returns an empty string. */
export declare function parseStaticClassLiteral(value: string): string | null;
/** Normalize a declared bean type to the graph's simple/qualified raw type key. */
export declare function normalizeSpringBeanType(rawType: string): string | null;
