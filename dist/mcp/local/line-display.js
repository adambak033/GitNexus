export function toDisplayLine(zeroBasedLine) {
    return typeof zeroBasedLine === 'number' ? zeroBasedLine + 1 : undefined;
}
