import { type SpringAopReason } from '../../core/ingestion/frameworks/spring/aop.js';
type SpringAopBehaviorReason = Extract<SpringAopReason, {
    kind: 'behavior';
}>;
type SpringAopAdviceReason = Extract<SpringAopReason, {
    kind: 'advice';
}>;
type SpringAopAspectReason = Extract<SpringAopReason, {
    kind: 'aspect';
}>;
type SpringAopPointcutReason = Extract<SpringAopReason, {
    kind: 'pointcut';
}>;
export interface SpringAopBehaviorMetadata {
    readonly annotation: string;
    readonly behavior: SpringAopBehaviorReason['behavior'];
    readonly declaredOn: SpringAopBehaviorReason['declaredOn'];
    readonly activation: SpringAopBehaviorReason['activation'];
    readonly evidenceId: string;
}
export interface SpringAopAdviceMetadata {
    readonly annotation: string;
    readonly advice: SpringAopAdviceReason['advice'];
    readonly pointcut: string;
    readonly match: SpringAopAdviceReason['match'];
    readonly activation: SpringAopAdviceReason['activation'];
    readonly adviceId: string;
    readonly adviceName?: string;
    readonly adviceFilePath?: string;
    readonly advisedId: string;
    readonly advisedName?: string;
    readonly advisedFilePath?: string;
}
export interface SpringAopUnresolvedPointcutMetadata {
    readonly annotation: string;
    readonly pointcut: string | null;
    readonly adviceId: string;
    readonly adviceName?: string;
    readonly adviceFilePath?: string;
    readonly evidenceId: string;
}
export interface SpringAopResolvedPointcutMetadata {
    readonly annotation: string;
    readonly pointcut: string;
    readonly match: Extract<SpringAopPointcutReason['match'], 'static'>;
    readonly resolution: Extract<SpringAopPointcutReason['resolution'], 'resolved'>;
    readonly adviceId: string;
    readonly adviceName?: string;
    readonly adviceFilePath?: string;
    readonly evidenceId: string;
}
export interface SpringAopAspectMetadata {
    readonly annotation: string;
    readonly activation: SpringAopAspectReason['activation'];
    readonly registration: SpringAopAspectReason['registration'];
    readonly evidenceId: string;
}
export interface SpringAopMetadata {
    readonly framework: 'spring';
    readonly proxied?: 'possible';
    readonly truncated?: true;
    readonly aspect?: SpringAopAspectMetadata;
    readonly behaviors: readonly SpringAopBehaviorMetadata[];
    readonly advices: readonly SpringAopAdviceMetadata[];
    readonly resolvedPointcuts: readonly SpringAopResolvedPointcutMetadata[];
    readonly unresolvedPointcuts: readonly SpringAopUnresolvedPointcutMetadata[];
}
/**
 * Read additive Spring proxy/advice metadata for context and impact results.
 *
 * The helper intentionally trusts only versioned reasons accepted by the
 * shared decoder. Other DECLARES edges (for example Spring Bean factories)
 * and malformed/forward-version evidence are ignored. Query failures are
 * fail-soft because older or partially upgraded indexes must remain readable.
 */
export declare function querySpringAopMetadata(lbugPath: string, symbolId: string, symbolType: string): Promise<SpringAopMetadata | undefined>;
export {};
