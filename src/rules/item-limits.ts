import type { Catalog, ItemVariant } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findItem, findItemVariant } from '../match/lookup.js';
import type { ItemTypeSelection } from './item-allowlist.js';

/** Item limits only support these scopes (each survivor brings a single item). */
export type ItemScope = 'duo' | 'team';

/**
 * One limit, generalised:
 * - `perPerk` (DUPLICATE): each item may be brought by at most `max` members of the scope;
 * - `total` (PICK): the scope may bring at most `max` of `items` in total.
 * `items` is null for a duplicate limit covering every allowed item ("all").
 */
export interface ItemLimit {
  scope: ItemScope;
  count: 'perPerk' | 'total';
  max: number;
  items: ItemVariant[] | null;
}

/** Render buckets, each sorted by scope (duo before team). */
export interface ClassifiedItemLimits {
  duplicate: ItemLimit[];
  pick: ItemLimit[];
}

const SCOPE_ORDER: string[] = ['duo', 'team'];
const scopeRank = (s: string) => {
  const i = SCOPE_ORDER.indexOf(s);
  return i === -1 ? SCOPE_ORDER.length : i;
};

/** Warning sink; receives plain messages (no prefix). */
export type WarnFn = (message: string) => void;

/**
 * Split limit IR entries into duplicate / pick buckets sorted by scope; pick limits with fewer
 * than 2 items or with `max >= items` are vacuous and dropped with a warning.
 */
export function classifyItemLimits(limits: ItemLimit[], source: string, warn: WarnFn): ClassifiedItemLimits {
  const duplicate: ItemLimit[] = [];
  const pick: ItemLimit[] = [];
  for (const lim of limits) {
    if (lim.count === 'perPerk') {
      duplicate.push(lim);
      continue;
    }
    const len = (lim.items ?? []).length;
    if (len < 2) {
      warn(
        `a pick limit (scope "${lim.scope}") in "${source}" resolves to ${len} allowed item(s); a pick limit needs at least 2; skipping.`,
      );
      continue;
    }
    if (lim.max >= len) {
      warn(
        `a pick limit (scope "${lim.scope}", max ${lim.max}) over ${len} items in "${source}" is vacuous (max is at least the number of items); skipping.`,
      );
      continue;
    }
    pick.push(lim);
  }
  const byScope = (a: ItemLimit, b: ItemLimit) => scopeRank(a.scope) - scopeRank(b.scope);
  duplicate.sort(byScope);
  pick.sort(byScope);
  return { duplicate, pick };
}

/** Rule sentence for one pick limit, keyed off scope and max. */
export function itemPickRuleText(rule: Pick<ItemLimit, 'scope' | 'max'>): string {
  const atMost = rule.max === 1 ? 'at most one' : `at most ${rule.max}`;
  switch (rule.scope) {
    case 'duo':
      return `Each duo may bring ${atMost} of these items between its two members.`;
    case 'team':
      return `The team may bring ${atMost} of these items.`;
    default:
      return `${atMost.charAt(0).toUpperCase()}${atMost.slice(1)} of these items may be brought.`;
  }
}

/** Rule sentence for one duplicate limit; `items` non-null means a listed subset. */
export function itemDuplicateRuleText(rule: Pick<ItemLimit, 'scope' | 'max' | 'items'>): string {
  const listed = rule.items ? ' listed' : '';
  if (rule.scope === 'duo') {
    if (rule.max === 1) return `Duo partners may not both bring the same${listed} item.`;
    return `At most ${rule.max} duo members may bring any single${listed} item.`;
  }
  if (rule.max === 1) return `No two survivors may bring the same${listed} item.`;
  return `At most ${rule.max} survivors may bring any single${listed} item.`;
}

/**
 * Parse `itemDuplicateLimits` / `itemPickLimits` into classified limits. Selectors refer to
 * the allowed pool: a plain string is an item-variant name; `{type: <Name>}` expands to all
 * allowed variants of that item type. Unknown names / types are errors; a known but not
 * allowed variant is dropped from the limit with a warning.
 *
 * @param cat        catalog
 * @param raw        `{itemDuplicateLimits, itemPickLimits}` from {@link parseItemAllowList}
 * @param selection  result of resolveItemAllowList (the allowed pool)
 * @param source     file path for messages
 * @param warn       warning sink (default: ignore)
 * @throws SheetError for authoring errors
 */
export function parseItemLimits(
  cat: Catalog,
  raw: { itemDuplicateLimits?: unknown; itemPickLimits?: unknown },
  selection: ItemTypeSelection[],
  source: string,
  warn: WarnFn = () => {},
): ClassifiedItemLimits {
  const dupRaw = raw.itemDuplicateLimits;
  const pickRaw = raw.itemPickLimits;
  if (dupRaw !== undefined && dupRaw !== null && !Array.isArray(dupRaw)) {
    throw new SheetError(`"itemDuplicateLimits" must be a list in "${source}".`);
  }
  if (pickRaw !== undefined && pickRaw !== null && !Array.isArray(pickRaw)) {
    throw new SheetError(`"itemPickLimits" must be a list in "${source}".`);
  }

  const allowedSlugs = new Set<string>();
  const allowedByType = new Map<string, ItemVariant[]>();
  for (const { item, variants } of selection) {
    allowedByType.set(item.slug, variants);
    for (const v of variants) allowedSlugs.add(v.slug);
  }

  const resolveSelector = (sel: unknown): ItemVariant[] => {
    if (typeof sel === 'string') {
      const v = findItemVariant(cat, sel);
      if (!v) {
        const hint = findItem(cat, sel) ? ` (did you mean the whole type? use { type: ${sel} })` : '';
        throw new SheetError(`Unknown item "${sel}" in a limit in file "${source}"${hint}.`);
      }
      if (!allowedSlugs.has(v.slug)) {
        warn(`a limit in "${source}" references "${v.name}", which is not in the allowed pool; dropping it from that limit.`);
        return [];
      }
      return [v];
    }
    if (typeof sel === 'object' && sel !== null && (sel as Record<string, unknown>).type !== undefined) {
      const typeText = String((sel as Record<string, unknown>).type);
      const item = findItem(cat, typeText);
      if (!item) throw new SheetError(`Unknown item type "${typeText}" in a limit in file "${source}".`);
      return allowedByType.get(item.slug) ?? [];
    }
    throw new SheetError(
      `Invalid item-limit selector ${JSON.stringify(sel)} in file "${source}". Expected a plain item name or a {type: <TypeName>} object.`,
    );
  };

  const resolveList = (selectors: unknown[]): ItemVariant[] => {
    const map = new Map<string, ItemVariant>();
    for (const sel of selectors) for (const v of resolveSelector(sel)) map.set(v.slug, v);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const validateScopeMax = (entry: Record<string, unknown>, label: string): void => {
    if (entry.scope !== 'duo' && entry.scope !== 'team') {
      throw new SheetError(
        `${label} in "${source}" has scope "${String(entry.scope)}"; item limits support only "duo" or "team" ` +
          `(each survivor brings a single item, so a per-survivor limit is meaningless).`,
      );
    }
    if (!Number.isInteger(entry.max) || (entry.max as number) < 1) {
      throw new SheetError(`${label} in "${source}" must have a positive integer "max".`);
    }
  };

  const irs: ItemLimit[] = [];

  for (const entry of (dupRaw as unknown[] | undefined | null) ?? []) {
    if (!entry || typeof entry !== 'object') {
      throw new SheetError(`Each itemDuplicateLimits entry must be a mapping in "${source}".`);
    }
    const e = entry as Record<string, unknown>;
    validateScopeMax(e, 'An itemDuplicateLimits entry');
    let items: ItemVariant[] | null = null;
    if (e.items !== undefined && e.items !== 'all' && e.items !== null) {
      if (!Array.isArray(e.items)) throw new SheetError(`itemDuplicateLimits "items" must be "all" or a list in "${source}".`);
      items = resolveList(e.items);
      if (items.length === 0) {
        warn(`an itemDuplicateLimits entry in "${source}" resolves to no allowed items; skipping.`);
        continue;
      }
    }
    irs.push({ scope: e.scope as ItemScope, count: 'perPerk', max: e.max as number, items });
  }

  for (const entry of (pickRaw as unknown[] | undefined | null) ?? []) {
    if (!entry || typeof entry !== 'object') {
      throw new SheetError(`Each itemPickLimits entry must be a mapping in "${source}".`);
    }
    const e = entry as Record<string, unknown>;
    validateScopeMax(e, 'An itemPickLimits entry');
    if (!Array.isArray(e.items) || e.items.length < 2) {
      throw new SheetError(`An itemPickLimits entry in "${source}" must list at least 2 items under "items".`);
    }
    irs.push({ scope: e.scope as ItemScope, count: 'total', max: e.max as number, items: resolveList(e.items) });
  }

  return classifyItemLimits(irs, source, warn);
}
