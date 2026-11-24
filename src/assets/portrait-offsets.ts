/**
 * Per-killer vertical crop offset for the square portrait crop, in SOURCE pixels
 * measured from the top of the portrait image (`sy`). Missing slug => 0 (top square).
 * Add an entry when a killer's face falls outside the top square.
 */
export const PORTRAIT_OFFSETS: Record<string, number> = {};
