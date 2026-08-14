/** Classify a dropped receiver from its encoded chain. `undefined` chain ⇒
 *  `no-chain`; an undecodable one is also `no-chain`, since what we know about
 *  it is exactly that no usable structure survived.
 *
 *  Takes `DecodedReceiverChain` rather than a structural duck-type: widening
 *  `kind` to `string` let `await` and `index` fall into an `else` branch and be
 *  counted as FIELDS, so the two shapes this work exists to expose were
 *  censused as `chain-field`. The discriminated union makes a new step kind a
 *  compile error instead of a silent bucket. */
export function classifyReceiverShape(decoded) {
    if (decoded === undefined || decoded.steps.length === 0)
        return 'no-chain';
    let calls = 0;
    let fields = 0;
    let unwraps = 0;
    for (const step of decoded.steps) {
        switch (step.kind) {
            case 'call':
                calls++;
                break;
            case 'field':
                fields++;
                break;
            case 'await':
            case 'index':
                unwraps++;
                break;
        }
    }
    // An unwrap step dominates: a chain containing one fails for reasons a pure
    // field or call chain does not, so folding it into either bucket would
    // misattribute the population a fix has to target.
    if (unwraps > 0)
        return 'chain-unwrap';
    if (calls > 0 && fields > 0)
        return 'chain-mixed';
    return calls > 0 ? 'chain-call' : 'chain-field';
}
