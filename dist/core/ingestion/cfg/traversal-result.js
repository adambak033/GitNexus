/** A sequence of statements that produced no blocks (e.g. an empty body). */
export const emptyTraversal = (entry) => ({ entry, exits: [entry] });
