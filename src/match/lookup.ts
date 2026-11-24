import { SheetError } from '../errors.js';
import type {
  Catalog,
  Item,
  ItemAddon,
  ItemVariant,
  Killer,
  Offering,
  Perk,
  PowerAddon,
  Side,
} from '../assets/catalog.js';
import { normalize } from './normalize.js';

/** One record plus the strings it can be referred to by. */
export interface IndexEntry<T> {
  record: T;
  /** Canonical names (e.g. display name). These beat any alias of another record. */
  names: string[];
  /** Aliases / abbreviations / former names. Alias-vs-alias collisions are ambiguous. */
  aliases?: string[];
}

/**
 * Normalised-name -> record index. Lookup precedence: canonical `names` first, then `aliases`.
 * If several DIFFERENT records match at the winning tier, {@link NameIndex.get} throws SheetError
 * listing the candidates (instead of the legacy silent last-wins).
 */
export class NameIndex<T> {
  private readonly canonical = new Map<string, Set<T>>();
  private readonly alias = new Map<string, Set<T>>();

  /** @param describe renders a record for ambiguity messages */
  constructor(
    entries: IndexEntry<T>[],
    private readonly describe: (r: T) => string = (r) => String(r),
  ) {
    const put = (m: Map<string, Set<T>>, k: string, r: T) => {
      const key = normalize(k);
      if (!key) return;
      let s = m.get(key);
      if (!s) m.set(key, (s = new Set()));
      s.add(r);
    };
    for (const e of entries) {
      for (const n of e.names) put(this.canonical, n, e.record);
      for (const a of e.aliases ?? []) put(this.alias, a, e.record);
    }
  }

  /** Resolve `text`; undefined if unknown; throws SheetError if ambiguous. */
  get(text: string): T | undefined {
    const key = normalize(text);
    for (const m of [this.canonical, this.alias]) {
      const hits = m.get(key);
      if (!hits) continue;
      if (hits.size === 1) return [...hits][0];
      throw new SheetError(
        `"${text}" is ambiguous; it could be: ${[...hits].map((r) => this.describe(r)).join(', ')}. Use a more specific name.`,
      );
    }
    return undefined;
  }
}

const caches = new WeakMap<Catalog, Map<string, NameIndex<any>>>();

function cached<T>(cat: Catalog, key: string, build: () => NameIndex<T>): NameIndex<T> {
  let m = caches.get(cat);
  if (!m) caches.set(cat, (m = new Map()));
  let idx = m.get(key);
  if (!idx) m.set(key, (idx = build()));
  return idx;
}

const perkEntries = (perks: Perk[]): IndexEntry<Perk>[] =>
  perks.map((p) => ({
    record: p,
    names: [p.name],
    aliases: [...(p.renamedFrom ? [p.renamedFrom.name] : []), ...p.aliases, ...p.abbreviations],
  }));

/** Uncached name index over any list of perks (e.g. a narrowed universe): canonical name > renamed_from / aliases / abbreviations. */
export function perkNameIndex(perks: Perk[]): NameIndex<Perk> {
  return new NameIndex(perkEntries(perks), (p) => p.name);
}

/** Cached name index over ALL perks of one side (what {@link findPerk} queries). */
export function perkIndex(cat: Catalog, side: Side): NameIndex<Perk> {
  return cached(cat, `perk:${side}`, () => perkNameIndex(cat.perksBySide[side]));
}

const killerEntries = (ks: Killer[]): IndexEntry<Killer>[] =>
  ks.map((k) => ({
    record: k,
    // "The Trapper" is also reachable as "Trapper" (alias tier, so a real name/alias wins).
    names: [k.name],
    aliases: [...k.aliases, k.name.replace(/^the\s+/i, '')],
  }));

const simple = <T extends { name: string }>(rs: T[]): IndexEntry<T>[] =>
  rs.map((r) => ({ record: r, names: [r.name] }));

/** Killer by name or alias ("The Trapper", "trapper", "Bubba"). */
export function findKiller(cat: Catalog, text: string): Killer | undefined {
  return cached(cat, 'killer', () => new NameIndex(killerEntries(cat.killers), (k) => k.name)).get(text);
}

/** Perk on the given side by name, former name (renamed_from), alias or abbreviation. */
export function findPerk(cat: Catalog, side: Side, text: string): Perk | undefined {
  return perkIndex(cat, side).get(text);
}

/** Perk on either side (use to produce a "this is a survivor perk" message). */
export function findPerkAnySide(cat: Catalog, text: string): Perk | undefined {
  return cached(cat, 'perk:any', () => new NameIndex(perkEntries(cat.perks), (p) => `${p.name} (${p.side})`)).get(text);
}

/** Power add-on of a specific killer (by killer slug). */
export function findPowerAddon(cat: Catalog, killerSlug: string, text: string): PowerAddon | undefined {
  return cached(
    cat,
    `addon:${killerSlug}`,
    () => new NameIndex(simple(cat.addonsByKiller.get(killerSlug) ?? []), (a) => a.slug),
  ).get(text);
}

/** Item variant (e.g. "Sport Flashlight") across all items. */
export function findItemVariant(cat: Catalog, text: string): ItemVariant | undefined {
  return cached(cat, 'variant', () => new NameIndex(simple(cat.itemVariants), (v) => v.slug)).get(text);
}

/** Item variant restricted to one item (by item slug). */
export function findItemVariantInItem(cat: Catalog, itemSlug: string, text: string): ItemVariant | undefined {
  return cached(
    cat,
    `variant:${itemSlug}`,
    () => new NameIndex(simple(cat.itemsBySlug.get(itemSlug)?.variants ?? []), (v) => v.slug),
  ).get(text);
}

/** Item add-on of a specific item (by item slug). */
export function findItemAddon(cat: Catalog, itemSlug: string, text: string): ItemAddon | undefined {
  return cached(
    cat,
    `itemaddon:${itemSlug}`,
    () => new NameIndex(simple(cat.itemAddonsByItem.get(itemSlug) ?? []), (a) => a.slug),
  ).get(text);
}

/** Item type by name ("Med-Kit", "Flashlight"). */
export function findItem(cat: Catalog, text: string): Item | undefined {
  return cached(cat, 'item', () => new NameIndex(simple(cat.items), (i) => i.slug)).get(text);
}

/** Offering: requested side first, then any side (some offerings exist on both). */
export function findOffering(cat: Catalog, side: Side, text: string): Offering | undefined {
  const bySide = cached(
    cat,
    `offering:${side}`,
    () => new NameIndex(simple(cat.offerings.filter((o) => o.side === side)), (o) => o.slug),
  ).get(text);
  if (bySide) return bySide;
  return cached(cat, 'offering:any', () => new NameIndex(simple(cat.offerings), (o) => `${o.slug} (${o.side})`)).get(text);
}
