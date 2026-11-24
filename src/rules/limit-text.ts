/**
 * Wording and ordering shared by perk limits and item limits (the two families mirror each
 * other and differ only in the noun and in which scopes can occur).
 */

/** Scope of a limit rule. Perks use all four; items only `duo` / `team`. */
export type LimitScopeName = 'survivor' | 'duo' | 'team' | 'build';

/** Global scope ordering (strictest-per-person first) for rendered limit buckets. */
export const SCOPE_ORDER: readonly LimitScopeName[] = ['survivor', 'duo', 'team', 'build'];

/** Position of `scope` in {@link SCOPE_ORDER}; unknown scopes sort last. */
export function scopeRank(scope: string): number {
  const i = (SCOPE_ORDER as readonly string[]).indexOf(scope);
  return i === -1 ? SCOPE_ORDER.length : i;
}

/** Stable in-place sort of limits by {@link SCOPE_ORDER}. */
export function sortByScope<T extends { scope: string }>(limits: T[]): T[] {
  return limits.sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope));
}

/** The thing a limit counts: `'perk'` or `'item'`. */
export type LimitNoun = 'perk' | 'item';

/**
 * Rule sentence for a single pick limit ("at most N of these `<noun>s`"), keyed off scope and
 * max. `survivor` and `build` scopes only occur for perks.
 */
export function pickRuleText(rule: { scope: string; max: number }, noun: LimitNoun): string {
  const atMost = rule.max === 1 ? 'at most one' : `at most ${rule.max}`;
  switch (rule.scope) {
    case 'survivor':
      return `One survivor may bring ${atMost} of these ${noun}s.`;
    case 'duo':
      return `Each duo may bring ${atMost} of these ${noun}s between its two members.`;
    case 'team':
      return `The team may bring ${atMost} of these ${noun}s.`;
    case 'build':
      return `The killer may bring ${atMost} of these ${noun}s in one build.`;
    default:
      return `${atMost.charAt(0).toUpperCase()}${atMost.slice(1)} of these ${noun}s may be brought.`;
  }
}

/**
 * Rule sentence for one duplicate (repetition) limit.
 * @param listed true when the limit covers a listed subset rather than every allowed `<noun>`
 */
export function duplicateRuleText(rule: { scope: string; max: number }, listed: boolean, noun: LimitNoun): string {
  const l = listed ? ' listed' : '';
  if (rule.scope === 'duo') {
    if (rule.max === 1) return `Duo partners may not both bring the same${l} ${noun}.`;
    return `At most ${rule.max} duo members may bring any single${l} ${noun}.`;
  }
  if (rule.max === 1) return `No two survivors may bring the same${l} ${noun}.`;
  return `At most ${rule.max} survivors may bring any single${l} ${noun}.`;
}
