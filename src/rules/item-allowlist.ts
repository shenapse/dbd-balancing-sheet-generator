import { z } from 'zod';
import type { Catalog, Item, ItemAddon, ItemVariant } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findItem } from '../match/lookup.js';
import { normalize } from '../match/normalize.js';
import { rarityToIndex } from './addon-allowlist.js';
import { formatZodError } from './yaml.js';

const selectorList = z.array(z.unknown()).nullish();
const blockShape = { default: z.unknown().optional(), allow: selectorList, deny: selectorList };

/** `{default, allow, deny}` block for variants or item add-ons. */
export const itemBlockSchema = z.looseObject(blockShape);
/** Per item type block: variant selection plus an optional `addons:` block (other keys such as `count` are ignored). */
export const itemTypeSchema = z.looseObject({ ...blockShape, addons: itemBlockSchema.nullish() });
export type ItemBlock = z.infer<typeof itemBlockSchema>;
export type ItemTypeConfig = z.infer<typeof itemTypeSchema>;

/**
 * Item allow-list document. Unknown top-level keys are tolerated (legacy behaviour).
 * Limit lists are validated in item-limits.ts.
 */
export const itemAllowListSchema = z.looseObject({
  killer: z.string().min(1),
  balancing: z.unknown().optional(),
  default: z.unknown().optional(),
  items: z.record(z.string(), itemTypeSchema.nullable()).nullish(),
  itemDuplicateLimits: z.unknown().optional(),
  itemPickLimits: z.unknown().optional(),
});

/** Parsed item allow-list file. */
export interface ItemAllowListDoc {
  killerText: string;
  balancing: string;
  /** Top-level `default` (allow|deny), 'deny' when absent. */
  topDefault: 'allow' | 'deny';
  items: Record<string, ItemTypeConfig | null>;
  /** The raw limit lists, for parseItemLimits. */
  raw: { itemDuplicateLimits?: unknown; itemPickLimits?: unknown };
}

/**
 * Validate a loaded YAML document as an item allow-list.
 * @throws SheetError on a non-object document or schema violation
 */
export function parseItemAllowList(doc: unknown, source: string): ItemAllowListDoc {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SheetError(`File "${source}" does not contain a YAML object.`);
  }
  const r = itemAllowListSchema.safeParse(doc);
  if (!r.success) throw new SheetError(formatZodError(source, r.error));
  const d = r.data;
  const topDefault = (d.default as unknown) || 'deny';
  if (topDefault !== 'allow' && topDefault !== 'deny') {
    throw new SheetError(`Top-level "default" must be "allow" or "deny" in file "${source}".`);
  }
  return {
    killerText: d.killer,
    balancing: d.balancing == null ? '' : String(d.balancing).trim(),
    topDefault,
    items: d.items ?? {},
    raw: { itemDuplicateLimits: d.itemDuplicateLimits, itemPickLimits: d.itemPickLimits },
  };
}

/** Resolved selection for one item type. */
export interface ItemTypeSelection {
  item: Item;
  /** Allowed variants sorted by name. */
  variants: ItemVariant[];
  /** Allowed add-ons of the type sorted by name. */
  addons: ItemAddon[];
}

/** Item types in the order the legacy sheet shows them (dbd-assets data order differs). Unknown extras follow in data order. */
export const ITEM_TYPE_ORDER = ['firecracker', 'flashlight', 'med-kit', 'toolbox', 'key', 'map', 'fog-vial'];

/** Catalog items in sheet order (see {@link ITEM_TYPE_ORDER}). */
export function itemsInSheetOrder(cat: Catalog): Item[] {
  const rank = (i: Item) => {
    const r = ITEM_TYPE_ORDER.indexOf(i.slug);
    return r === -1 ? ITEM_TYPE_ORDER.length : r;
  };
  return [...cat.items].sort((a, b) => rank(a) - rank(b)); // stable
}

/**
 * Resolve `allow`/`deny` of one block over `universe` (variants of one item, or add-ons of one
 * item). Selectors: plain name or `{rarity: name|index}` (0-5). Sorted by name.
 */
function resolveSelection<T extends { slug: string; name: string; rarity: number }>(
  cfg: ItemBlock | null | undefined,
  universe: T[],
  find: (name: string) => T | undefined,
  fallbackDefault: 'allow' | 'deny',
  label: string,
  source: string,
): T[] {
  const def = (cfg?.default as unknown) || fallbackDefault;
  if (def !== 'allow' && def !== 'deny') {
    throw new SheetError(`"default" must be "allow" or "deny" (${label}) in file "${source}".`);
  }
  const allowed = new Map<string, T>();
  if (def === 'allow') for (const e of universe) allowed.set(e.slug, e);

  const resolveSel = (sel: unknown): T[] => {
    if (typeof sel === 'string') {
      const e = find(sel);
      if (!e) throw new SheetError(`Unknown ${label} "${sel}" in file "${source}".`);
      return [e];
    }
    if (typeof sel === 'object' && sel !== null && (sel as Record<string, unknown>).rarity !== undefined) {
      const idx = rarityToIndex((sel as Record<string, unknown>).rarity, source, 6);
      return universe.filter((a) => a.rarity === idx);
    }
    throw new SheetError(
      `Invalid ${label} selector ${JSON.stringify(sel)} in file "${source}". ` +
        `Expected a plain name string or a {rarity: ...} object.`,
    );
  };

  for (const sel of cfg?.deny ?? []) for (const e of resolveSel(sel)) allowed.delete(e.slug);
  for (const sel of cfg?.allow ?? []) for (const e of resolveSel(sel)) allowed.set(e.slug, e);
  return [...allowed.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve the allowed item variants and item add-ons for every item type. Pure: reads only
 * the catalog. Reusable by the `builds` command.
 *
 * Semantics (legacy): per type, variants use the type's `default` falling back to
 * `topDefault`; the type's add-ons use `addons.default`, falling back to the type's default,
 * then `topDefault`. Unknown keys under `items:` are an error. All catalog item types are
 * returned (in sheet order), including ones with nothing allowed.
 *
 * @param cat         catalog
 * @param items       the `items:` mapping (type name -> block)
 * @param topDefault  top-level default
 * @param source      file path for error messages
 * @throws SheetError for unknown item types / names / selectors or bad `default`
 */
export function resolveItemAllowList(
  cat: Catalog,
  items: Record<string, ItemTypeConfig | null | undefined>,
  topDefault: 'allow' | 'deny',
  source: string,
): ItemTypeSelection[] {
  const cfgBySlug = new Map<string, ItemTypeConfig | null | undefined>();
  for (const [key, val] of Object.entries(items)) {
    const item = findItem(cat, key);
    if (!item) throw new SheetError(`Unknown item type "${key}" in file "${source}".`);
    if (!cfgBySlug.has(item.slug)) cfgBySlug.set(item.slug, val);
  }
  return itemsInSheetOrder(cat).map((item) => {
    const typeCfg = cfgBySlug.get(item.slug);
    const typeDefault = ((typeCfg?.default as unknown) || topDefault) as 'allow' | 'deny';
    const variantIdx = new Map<string, ItemVariant>();
    for (const v of item.variants) if (!variantIdx.has(normalize(v.name))) variantIdx.set(normalize(v.name), v);
    const addonUniverse = cat.itemAddonsByItem.get(item.slug) ?? [];
    const addonIdx = new Map<string, ItemAddon>();
    for (const a of addonUniverse) if (!addonIdx.has(normalize(a.name))) addonIdx.set(normalize(a.name), a);
    return {
      item,
      variants: resolveSelection(
        typeCfg,
        item.variants,
        (n) => variantIdx.get(normalize(n)),
        topDefault,
        `${item.name} variant`,
        source,
      ),
      addons: resolveSelection(
        typeCfg?.addons,
        addonUniverse,
        (n) => addonIdx.get(normalize(n)),
        typeDefault,
        `${item.name} add-on`,
        source,
      ),
    };
  });
}
