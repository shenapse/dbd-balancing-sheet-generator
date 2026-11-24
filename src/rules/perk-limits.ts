import type { Catalog, Perk, Side } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { matchSelector, sideIndex, type WarnFn } from './perk-selectors.js';

/** Scope of a perk limit. Killer-side limits use `build` (the killer's single build). */
export type LimitScope = 'survivor' | 'duo' | 'team' | 'build';

/** Scopes of survivor combination bans, in rendering (strictness) order. */
export const SURVIVOR_COMBO_SCOPES = ['survivor', 'duo', 'team'] as const;
/** Scopes an author may attach to a survivor-side pick limit. */
export const PICK_SURVIVOR_SCOPES = ['survivor', 'duo', 'team'] as const;
/** Scopes valid for repetition limits (survivor side only). */
export const REPETITION_SCOPES = ['duo', 'team'] as const;
/** Global scope ordering for rendered limit buckets. */
export const SCOPE_ORDER: readonly LimitScope[] = ['survivor', 'duo', 'team', 'build'];

function scopeRank(scope: LimitScope): number {
  const i = SCOPE_ORDER.indexOf(scope);
  return i === -1 ? SCOPE_ORDER.length : i;
}

/** A resolved combination ban: the perks may not all be brought together within the scope. */
export interface ComboBan {
  scope: LimitScope;
  perks: Perk[];
}

/** A resolved repetition limit; `perks` null = every allowed perk. */
export interface RepetitionLimit {
  scope: 'duo' | 'team';
  max: number;
  perks: Perk[] | null;
}

/**
 * Generalised perk-limit IR. `perPerk`: each perk in `perks` may be brought by at most `max`
 * members of the scope group (duplicate family). `total`: the group may bring at most `max`
 * perks drawn from `perks` in total (pick / combo family).
 */
export interface PerkLimit {
  scope: LimitScope;
  count: 'perPerk' | 'total';
  max: number;
  perks: Perk[] | null;
}

/** Rendered buckets produced by {@link classifyLimits}. */
export interface LimitBuckets {
  duplicate: PerkLimit[];
  pick: PerkLimit[];
  combo: PerkLimit[];
}

const jsonOf = (v: unknown): string => JSON.stringify(v) ?? String(v);

/** Resolve a list of names inside combo/pick/repetition rules against all perks of the side. */
function resolveNames(cat: Catalog, side: Side, names: unknown[], filePath: string): Perk[] {
  const lookup = sideIndex(cat, side);
  return names.map((sel) => matchSelector(sel, lookup, filePath)[0] as Perk);
}

function warnMoot(
  perks: Perk[],
  allowedSlugs: Set<string>,
  what: string,
  scope: string,
  sideName: string | null,
  filePath: string,
  warn: WarnFn,
  consequence: string,
): void {
  for (const p of perks) {
    if (!allowedSlugs.has(p.slug)) {
      warn(
        `${what} perk "${p.name}" (scope "${scope}"${sideName ? `, ${sideName} side` : ''}) is not in the ` +
          `allowed set in "${filePath}"; ${consequence} because that perk is already individually banned.`,
      );
    }
  }
}

/**
 * Resolve combination bans for one side into ordered `{ scope, perks }` entries.
 * Survivor config is a map keyed by scope (survivor/duo/team); killer config is a flat list under
 * the implicit `build` scope. Each combo is a list of 2+ perk names.
 *
 * @param comboConfig `survivorComboBans` (map) or `killerComboBans` (list); null/undefined => []
 * @param allowedPerks the side's allowed perks (for the moot-combo warning)
 * @param warn receives non-fatal warnings
 * @throws SheetError on bad shapes, unknown scopes/perks, combos with fewer than 2 perks
 */
export function resolveComboBans(
  cat: Catalog,
  comboConfig: unknown,
  side: Side,
  allowedPerks: Perk[],
  filePath: string,
  warn: WarnFn,
): ComboBan[] {
  if (comboConfig == null) return [];
  const allowed = new Set(allowedPerks.map((p) => p.slug));
  const out: ComboBan[] = [];

  const one = (entry: unknown, scope: LimitScope): void => {
    if (!Array.isArray(entry)) {
      throw new SheetError(
        `Combo ban entry (scope "${scope}") in file "${filePath}" must be a list of perk names, got ${jsonOf(entry)}.`,
      );
    }
    const perks = resolveNames(cat, side, entry, filePath);
    if (perks.length < 2) {
      throw new SheetError(
        `Combo ban (scope "${scope}") in file "${filePath}" needs at least 2 perks, got ${perks.length}: ${jsonOf(entry)}.`,
      );
    }
    warnMoot(perks, allowed, 'combo-ban', scope, side, filePath, warn, 'the combo is moot');
    out.push({ scope, perks });
  };

  if (side === 'survivor') {
    if (typeof comboConfig !== 'object' || Array.isArray(comboConfig)) {
      throw new SheetError(
        `"survivorComboBans" must be a map keyed by scope (${SURVIVOR_COMBO_SCOPES.join(' / ')}) in file "${filePath}".`,
      );
    }
    const rec = comboConfig as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (!(SURVIVOR_COMBO_SCOPES as readonly string[]).includes(key)) {
        throw new SheetError(
          `Unknown survivor combo-ban scope "${key}" in file "${filePath}". Valid scopes: ${SURVIVOR_COMBO_SCOPES.join(', ')}.`,
        );
      }
    }
    for (const scope of SURVIVOR_COMBO_SCOPES) {
      const list = rec[scope];
      if (list == null) continue;
      if (!Array.isArray(list)) {
        throw new SheetError(`Survivor combo-ban scope "${scope}" must be a list in file "${filePath}".`);
      }
      for (const entry of list) one(entry, scope);
    }
  } else {
    if (!Array.isArray(comboConfig)) {
      throw new SheetError(`"killerComboBans" must be a list of perk-name lists in file "${filePath}".`);
    }
    for (const entry of comboConfig) one(entry, 'build');
  }
  return out;
}

/**
 * Resolve survivor repetition limits (`survivorRepetitionLimits`: list of `{scope, max, perks}`)
 * sorted duo before team (stable within a scope). `perks` null = every allowed perk.
 *
 * @throws SheetError on invalid scope / max / perks
 */
export function resolveRepetitionLimits(
  cat: Catalog,
  config: unknown,
  allowedPerks: Perk[],
  filePath: string,
  warn: WarnFn,
): RepetitionLimit[] {
  if (config == null) return [];
  if (!Array.isArray(config)) {
    throw new SheetError(
      `"survivorRepetitionLimits" must be a list of { scope, max, perks } objects in file "${filePath}".`,
    );
  }
  const allowed = new Set(allowedPerks.map((p) => p.slug));
  const out: RepetitionLimit[] = [];

  for (const entry of config as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SheetError(
        `Each "survivorRepetitionLimits" entry must be a { scope, max, perks } object in file "${filePath}", got ${jsonOf(entry)}.`,
      );
    }
    const e = entry as Record<string, unknown>;
    const scope = e['scope'];
    if (scope !== 'duo' && scope !== 'team') {
      const extra =
        scope === 'survivor'
          ? ` The "survivor" scope is meaningless for repetition limits (one survivor cannot bring the same perk twice); use a combination ban instead.`
          : '';
      throw new SheetError(
        `Invalid repetition-limit scope ${jsonOf(scope)} in file "${filePath}". Valid scopes: ${REPETITION_SCOPES.join(', ')}.${extra}`,
      );
    }
    const max = e['max'];
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
      throw new SheetError(
        `Repetition-limit "max" (scope "${scope}") must be a positive integer in file "${filePath}", got ${jsonOf(max)}.`,
      );
    }
    if (scope === 'duo' && max >= 2) {
      warn(
        `repetition limit (scope "duo", max ${max}) in "${filePath}" is vacuous - a duo has only two members, so a max of ${max} never restricts anything.`,
      );
    }
    let perks: Perk[] | null = null;
    const decl = e['perks'];
    if (decl != null && decl !== 'all') {
      if (!Array.isArray(decl)) {
        throw new SheetError(
          `Repetition-limit "perks" (scope "${scope}") must be "all" or a list of perk names in file "${filePath}", got ${jsonOf(decl)}.`,
        );
      }
      perks = resolveNames(cat, 'survivor', decl, filePath);
      warnMoot(perks, allowed, 'repetition-limit', scope, null, filePath, warn, 'the limit is moot');
    }
    out.push({ scope, max, perks });
  }
  out.sort((a, b) => REPETITION_SCOPES.indexOf(a.scope) - REPETITION_SCOPES.indexOf(b.scope));
  return out;
}

/**
 * Resolve pick limits ("pick at most N perks from this list") into IR entries
 * `{ scope, count: 'total', max, perks }`. Survivor config: list of `{scope, max, perks}`;
 * killer config: list of `{max, perks}` (scope `build`). `perks` must be a list of 2+ names.
 *
 * @throws SheetError on invalid scope / max / perks
 */
export function resolvePickLimits(
  cat: Catalog,
  config: unknown,
  side: Side,
  allowedPerks: Perk[],
  filePath: string,
  warn: WarnFn,
): PerkLimit[] {
  if (config == null) return [];
  const isSurvivor = side === 'survivor';
  const label = isSurvivor ? 'survivorPickLimits' : 'killerPickLimits';
  const shape = isSurvivor ? '{ scope, max, perks }' : '{ max, perks }';
  if (!Array.isArray(config)) {
    throw new SheetError(`"${label}" must be a list of ${shape} objects in file "${filePath}".`);
  }
  const allowed = new Set(allowedPerks.map((p) => p.slug));
  const out: PerkLimit[] = [];

  for (const entry of config as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new SheetError(`Each "${label}" entry must be a ${shape} object in file "${filePath}", got ${jsonOf(entry)}.`);
    }
    const e = entry as Record<string, unknown>;
    let scope: LimitScope;
    if (isSurvivor) {
      const s = e['scope'];
      if (!(PICK_SURVIVOR_SCOPES as readonly unknown[]).includes(s)) {
        throw new SheetError(
          `Invalid pick-limit scope ${jsonOf(s)} in file "${filePath}". Valid scopes: ${PICK_SURVIVOR_SCOPES.join(', ')}.`,
        );
      }
      scope = s as LimitScope;
    } else {
      const s = e['scope'];
      if (s !== undefined && s !== 'killer' && s !== 'build') {
        throw new SheetError(
          `"killerPickLimits" entries take no scope (the killer is a single build); got scope ${jsonOf(s)} in file "${filePath}".`,
        );
      }
      scope = 'build';
    }
    const max = e['max'];
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
      throw new SheetError(
        `Pick-limit "max" (scope "${scope}") must be a positive integer in file "${filePath}", got ${jsonOf(max)}.`,
      );
    }
    const decl = e['perks'];
    if (!Array.isArray(decl)) {
      throw new SheetError(
        `Pick-limit "perks" (scope "${scope}") must be a list of perk names in file "${filePath}", got ${jsonOf(decl)}.`,
      );
    }
    const perks = resolveNames(cat, side, decl, filePath);
    if (perks.length < 2) {
      throw new SheetError(
        `Pick limit (scope "${scope}") in file "${filePath}" needs at least 2 perks to choose from, got ${perks.length}: ${jsonOf(decl)}.`,
      );
    }
    warnMoot(perks, allowed, 'pick-limit', scope, null, filePath, warn, 'the limit is moot');
    out.push({ scope, count: 'total', max, perks });
  }
  return out;
}

/** Lower resolved combo bans to IR: N perks => at most N-1 of them (`count: 'total'`). */
export function comboBansToLimits(combos: ComboBan[]): PerkLimit[] {
  return combos.map((c) => ({ scope: c.scope, count: 'total', max: c.perks.length - 1, perks: c.perks }));
}

/** Lower resolved repetition limits to IR (`count: 'perPerk'`). */
export function repetitionLimitsToLimits(reps: RepetitionLimit[]): PerkLimit[] {
  return reps.map((r) => ({ scope: r.scope, count: 'perPerk', max: r.max, perks: r.perks }));
}

/**
 * Reduce IR limits to the three concrete render buckets (duplicate / pick / combo). Vacuous or
 * unsupported entries are reported via `warn` and dropped. Buckets are sorted by scope order
 * (stable within a scope).
 */
export function classifyLimits(limits: PerkLimit[], filePath: string, warn: WarnFn): LimitBuckets {
  const duplicate: PerkLimit[] = [];
  const pick: PerkLimit[] = [];
  const combo: PerkLimit[] = [];
  for (const lim of limits) {
    if (lim.count === 'perPerk') {
      duplicate.push(lim);
      continue;
    }
    if (!lim.perks) {
      warn(
        `a total-count limit over all perks (scope "${lim.scope}") in "${filePath}" is a whole-loadout size cap, not a supported render target; skipping.`,
      );
      continue;
    }
    const len = lim.perks.length;
    if (lim.max >= len) {
      warn(
        `limit (scope "${lim.scope}", max ${lim.max}) over ${len} perks in "${filePath}" is vacuous (max is at least the number of perks); skipping.`,
      );
      continue;
    }
    if (lim.max === len - 1) combo.push(lim);
    else pick.push(lim);
  }
  const byScope = (a: PerkLimit, b: PerkLimit) => scopeRank(a.scope) - scopeRank(b.scope);
  duplicate.sort(byScope);
  pick.sort(byScope);
  combo.sort(byScope);
  return { duplicate, pick, combo };
}

/**
 * Rule sentence for a combination-ban group (one per scope); generalises to "all of these" when
 * any combo in the group has more than two perks.
 */
export function comboGroupRuleText(scope: LimitScope, combos: { perks: Perk[] }[]): string {
  const allPairs = combos.every((c) => c.perks.length === 2);
  switch (scope) {
    case 'survivor':
      return allPairs ? 'One survivor may not bring both perks.' : 'One survivor may not bring all of these together.';
    case 'duo':
      return allPairs
        ? 'Neither duo may bring both perks between its two members.'
        : 'A duo may not bring all of these between its two members.';
    case 'team':
      return allPairs
        ? 'If one survivor brings one perk, no other survivor may bring the other.'
        : 'The team may not bring all of these across its survivors.';
    case 'build':
      return allPairs
        ? 'The killer may not bring both perks in one build.'
        : 'The killer may not bring all of these in one build.';
    default:
      return 'These perks may not be brought together.';
  }
}

/** Rule sentence for a single pick limit, keyed off scope and max. */
export function pickRuleText(rule: { scope: LimitScope; max: number }): string {
  const atMost = rule.max === 1 ? 'at most one' : `at most ${rule.max}`;
  switch (rule.scope) {
    case 'survivor':
      return `One survivor may bring ${atMost} of these perks.`;
    case 'duo':
      return `Each duo may bring ${atMost} of these perks between its two members.`;
    case 'team':
      return `The team may bring ${atMost} of these perks.`;
    case 'build':
      return `The killer may bring ${atMost} of these perks in one build.`;
    default:
      return `${atMost.charAt(0).toUpperCase()}${atMost.slice(1)} of these perks may be brought.`;
  }
}

/** Rule sentence for one repetition limit (`perks` non-null = a listed subset). */
export function repetitionRuleText(rule: { scope: LimitScope; max: number; perks: unknown[] | null }): string {
  const listed = rule.perks ? ' listed' : '';
  if (rule.scope === 'duo') {
    if (rule.max === 1) return `Duo partners may not both bring the same${listed} perk.`;
    return `At most ${rule.max} duo members may bring any single${listed} perk.`;
  }
  if (rule.max === 1) return `No two survivors may bring the same${listed} perk.`;
  return `At most ${rule.max} survivors may bring any single${listed} perk.`;
}
