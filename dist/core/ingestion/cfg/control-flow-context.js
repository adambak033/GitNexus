export class ControlFlowContext {
    stack = [];
    pushLoop(continueTo, breakTo, labels = []) {
        this.stack.push({ kind: 'loop', continueTo, breakTo, labels });
    }
    pushSwitch(breakTo, labels = []) {
        this.stack.push({ kind: 'switch', breakTo, labels });
    }
    /** Push a labeled non-loop statement's break-target frame. */
    pushLabeledBlock(breakTo, labels) {
        this.stack.push({ kind: 'block', breakTo, labels });
    }
    /**
     * Push a finalizer frame and return it — the owning `visitTry` keeps the
     * reference to wire {@link FinalizerFrame.pending} after popping it.
     */
    pushFinalizer(entry) {
        const frame = { kind: 'finalizer', entry, pending: [] };
        this.stack.push(frame);
        return frame;
    }
    pop() {
        this.stack.pop();
    }
    /**
     * Resolve a `break`: the nearest enclosing loop/switch frame (or, with a
     * label, the nearest frame carrying that label) plus every finalizer frame
     * stacked ABOVE it — i.e. exactly the finallys the jump crosses, innermost
     * first. Returns `undefined` if there is no valid target (malformed input or
     * an unmodeled label) — the caller falls back to its conservative routing and
     * threads nothing.
     */
    resolveBreak(label) {
        return this.resolve((f) => label === undefined
            ? f.kind !== 'block' // an unlabeled break never targets a labeled block
            : f.labels.includes(label));
    }
    /** Resolve a `continue`: like {@link resolveBreak} but only loop frames match. */
    resolveContinue(label) {
        return this.resolve((f) => f.kind === 'loop' && (label === undefined || f.labels.includes(label)), (f) => f.continueTo);
    }
    /**
     * Resolve a Java `yield e` (switch-EXPRESSION arm exit): the nearest enclosing
     * SWITCH frame's exit, threading the finalizers stacked above it. Unlike a
     * `break`, a `yield` ALWAYS targets the switch — never an intervening loop — so
     * it cannot match a loop frame (a `yield` inside a loop inside a switch arm
     * still exits the whole switch). Returns `undefined` when there is no enclosing
     * switch (malformed input); the caller falls back to its conservative routing.
     */
    resolveYield() {
        return this.resolve((f) => f.kind === 'switch');
    }
    /** Every active finalizer, innermost first — what a `return` must cross. */
    finalizersForReturn() {
        const fins = [];
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const f = this.stack[i];
            if (f.kind === 'finalizer')
                fins.push(f);
        }
        return fins;
    }
    /**
     * Target block for a `break` (no finalizer info) — see {@link resolveBreak}.
     * Prefer `resolveBreak` + {@link wireJumpThroughFinalizers} in visitors: a
     * target-only lookup silently loses finalizer threading (the M2 soundness
     * fix). Kept for target-shape assertions in tests.
     */
    breakTarget(label) {
        return this.resolveBreak(label)?.target;
    }
    /** Target block for a `continue` — same caveat as {@link breakTarget}. */
    continueTarget(label) {
        return this.resolveContinue(label)?.target;
    }
    resolve(matches, targetOf = (f) => f.breakTo) {
        const crossed = [];
        for (let i = this.stack.length - 1; i >= 0; i--) {
            const f = this.stack[i];
            if (f.kind === 'finalizer') {
                crossed.push(f);
                continue;
            }
            if (matches(f))
                return { target: targetOf(f), finalizers: crossed };
        }
        return undefined;
    }
}
/**
 * Wire a jump from `from` to `target`, routing through the finallys it
 * crosses (innermost first). The first leg keeps the bare jump `kind`
 * (preserving the "kind ⟹ source-block terminator" invariant in types.ts);
 * each finally's completion leg is registered as pending on its frame with the
 * matching `finally-*` kind and wired by the owning try via
 * {@link drainFinalizerPending} once the finally's exits are known.
 *
 * Language-agnostic on purpose (#2082 M2): the threading protocol encodes
 * three subtle invariants every future language visitor needs identically —
 * keeping it here means a new visitor cannot drift on any of them.
 */
export function wireJumpThroughFinalizers(builder, from, finalizers, target, kind) {
    if (finalizers.length === 0) {
        builder.edge(from, target, kind);
        return;
    }
    const completionKind = `finally-${kind}`;
    builder.edge(from, finalizers[0].entry, kind);
    for (let i = 0; i < finalizers.length; i++) {
        const to = i + 1 < finalizers.length ? finalizers[i + 1].entry : target;
        finalizers[i].pending.push({ to, kind: completionKind });
    }
}
/**
 * Wire a popped finalizer frame's pending completion legs from the finally's
 * exit blocks. A finally that itself always jumps (`finally { return 2; }`)
 * has no exits — its pending legs wire nowhere, matching JS's
 * finally-override semantics.
 */
export function drainFinalizerPending(builder, frame, finallyExits) {
    for (const p of frame.pending) {
        builder.connect(finallyExits, p.to, p.kind);
    }
}
