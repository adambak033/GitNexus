/**
 * Method Registry
 *
 * Owner-scoped method index extracted from SymbolTable.
 * Stores Method/Constructor/Function-with-ownerId symbols keyed by
 * `ownerNodeId\0methodName` for O(1) lookup. Supports overloads
 * (array values) and arity-based filtering.
 */
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export const createMethodRegistry = () => {
    const methodByOwner = new Map();
    // Secondary flat-by-name index. Values are the SAME SymbolDefinition
    // references stored under `methodByOwner` — no copy, just a second key.
    // Populated in lockstep by `register()` and emptied by `clear()`.
    const methodsByName = new Map();
    const EMPTY = Object.freeze([]);
    // Set once when a Function+ownerId def lands here, powers the Tier 3
    // dedup fast-path. Monotonic: never unset except on `clear()`.
    let hasFunctionMethodsFlag = false;
    const lookupMethodByOwner = (ownerNodeId, methodName, argCount) => {
        const defs = methodByOwner.get(`${ownerNodeId}\0${methodName}`);
        if (!defs || defs.length === 0)
            return undefined;
        // Arity narrowing: when an argCount is provided and there are multiple
        // overloads, keep only those whose parameterCount can accommodate the
        // call. This resolves arity-differing overloads (e.g. C++ `greet()` vs
        // `greet(string)`) that share the same `ownerId + methodName` key.
        //
        // Candidates with `parameterCount === undefined` (extractor didn't
        // populate the count — typically variadic or unknown) are retained
        // conservatively so that legitimate variadic matches still resolve.
        //
        // Streaming loop avoids allocating a filtered array on the common
        // "arity selects 0 or 1 match" path. We scan once, count arity
        // matches, and only materialize a narrowed array if at least one
        // match was found and at least one non-match exists. If arity rules
        // out every candidate, fall back to the unfiltered set so the
        // caller's fuzzy path still has something to work with.
        let pool = defs;
        if (argCount !== undefined && defs.length > 1) {
            let matchedCount = 0;
            let rejectedCount = 0;
            for (const d of defs) {
                if (d.parameterCount === undefined) {
                    matchedCount++;
                    continue;
                }
                const min = d.requiredParameterCount ?? d.parameterCount;
                if (argCount >= min && argCount <= d.parameterCount)
                    matchedCount++;
                else
                    rejectedCount++;
            }
            // Only narrow when the filter actually discriminates: at least one
            // match AND at least one rejection. Pure-match and pure-reject
            // paths both keep the unfiltered pool (the latter because fallback
            // semantics demand it).
            if (matchedCount > 0 && rejectedCount > 0) {
                const arityMatched = [];
                for (const d of defs) {
                    if (d.parameterCount === undefined) {
                        arityMatched.push(d);
                        continue;
                    }
                    const min = d.requiredParameterCount ?? d.parameterCount;
                    if (argCount >= min && argCount <= d.parameterCount)
                        arityMatched.push(d);
                }
                pool = arityMatched;
            }
        }
        if (pool.length === 1)
            return pool[0];
        // Multiple overloads after arity narrowing: return first if all share
        // the same defined returnType (safe for chain resolution), undefined if
        // return types differ (truly ambiguous — can't determine which overload).
        const firstReturnType = pool[0].returnType;
        if (firstReturnType === undefined)
            return undefined;
        for (let i = 1; i < pool.length; i++) {
            if (pool[i].returnType !== firstReturnType)
                return undefined;
        }
        return pool[0];
    };
    const lookupMethodByName = (name) => {
        return methodsByName.get(name) ?? EMPTY;
    };
    const lookupAllByOwner = (ownerNodeId, methodName) => {
        return methodByOwner.get(`${ownerNodeId}\0${methodName}`) ?? EMPTY;
    };
    const register = (ownerNodeId, methodName, def) => {
        const key = `${ownerNodeId}\0${methodName}`;
        const existing = methodByOwner.get(key);
        if (existing) {
            existing.push(def);
        }
        else {
            methodByOwner.set(key, [def]);
        }
        const byName = methodsByName.get(methodName);
        if (byName) {
            byName.push(def);
        }
        else {
            methodsByName.set(methodName, [def]);
        }
        // A `Function`-typed def reaching MethodRegistry means the worker
        // emitted a Python/Rust/Kotlin class method as `Function + ownerId`.
        // It was already written into `SymbolTable.callableByName` by the
        // upstream Function callable-index gate, so the two indexes are no
        // longer disjoint for this registry's lifetime — Tier 3 must dedup.
        if (!hasFunctionMethodsFlag && def.type === 'Function') {
            hasFunctionMethodsFlag = true;
        }
    };
    const clear = () => {
        methodByOwner.clear();
        methodsByName.clear();
        hasFunctionMethodsFlag = false;
    };
    return {
        lookupMethodByOwner,
        lookupMethodByName,
        lookupAllByOwner,
        register,
        clear,
        get hasFunctionMethods() {
            return hasFunctionMethodsFlag;
        },
    };
};
