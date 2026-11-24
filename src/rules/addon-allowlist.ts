import { z } from 'zod';
import { RARITY, type Catalog, type PowerAddon } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findPowerAddon } from '../match/lookup.js';
import { normalize } from '../match/normalize.js';
import { formatZodError } from './yaml.js';

/**
 * Resolve a rarity selector value (name such as "Very Rare" or numeric index) to an index.
 * @param value   YAML value of `{rarity: ...}` / `{tier: ...}`
 * @param source  file path used in error messages
 * @param count   number of valid rarities (5 for power add-ons, 6 for items / item add-ons)
 * @throws SheetError when the value is out of range or unknown
 */
export function rarityToIndex(value: unknown, source: string, count: number = 5): number {
  const names = RARITY.slice(0, count);
  if (typeof value === 'number') {
    if (value >= 0 && value < count) return value;
    throw new SheetError(`Rarity index ${value} out of range (0-${count - 1}) in "${source}".`);
  }
  const norm = normalize(String(value));
  const idx = names.findIndex((n) => normalize(n) === norm);
  if (idx === -1) {
    throw new SheetError(
      `Unknown rarity "${String(value)}" in "${source}". Expected one of: ${names.join(', ')} (or a 0-${count - 1} index).`,
    );
  }
  return idx;
}

const selectorList = z.array(z.unknown()).nullish();

/** `{default, allow, deny}` block. Selectors are validated lazily by {@link matchSelector}. */
export const addonSectionSchema = z.looseObject({
  default: z.unknown().optional(),
  allow: selectorList,
  deny: selectorList,
});
export type AddonSection = z.infer<typeof addonSectionSchema>;

/**
 * Add-on allow-list document. Unknown top-level keys (killerPerks, items, display, ...) are
 * tolerated, as in the legacy tool. The section is `addons:` or, if absent, top-level
 * default/allow/deny.
 */
export const addonAllowListSchema = z.looseObject({
  killer: z.string().min(1),
  balancing: z.unknown().optional(),
  addons: addonSectionSchema.nullish(),
  default: z.unknown().optional(),
  allow: selectorList,
  deny: selectorList,
});

/** Parsed add-on allow-list file. */
export interface AddonAllowListDoc {
  /** Killer text as written in the YAML (resolve it with findKiller). */
  killerText: string;
  /** Trimmed `balancing:` label, '' if absent. */
  balancing: string;
  section: AddonSection;
}

/**
 * Validate a loaded YAML document (see loadYamlFile) as an add-on allow-list.
 * @throws SheetError on a non-object document or schema violation
 */
export function parseAddonAllowList(doc: unknown, source: string): AddonAllowListDoc {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SheetError(`File "${source}" does not contain a YAML object.`);
  }
  const r = addonAllowListSchema.safeParse(doc);
  if (!r.success) throw new SheetError(formatZodError(source, r.error));
  const d = r.data;
  return {
    killerText: d.killer,
    balancing: d.balancing == null ? '' : String(d.balancing).trim(),
    section: d.addons ?? { default: d.default, allow: d.allow, deny: d.deny },
  };
}

/**
 * Apply one selector to a killer's add-on universe.
 * @param selector  add-on name (string), `{rarity: name|index}` or `{tier: name|index}`
 * @param universe  all add-ons of the killer
 * @param find      name -> add-on lookup within the universe
 * @param source    file path for error messages
 * @returns matched add-ons
 * @throws SheetError for unknown names / malformed selectors
 */
export function matchSelector(
  selector: unknown,
  universe: PowerAddon[],
  find: (name: string) => PowerAddon | undefined,
  source: string,
): PowerAddon[] {
  if (typeof selector === 'string') {
    const addon = find(selector);
    if (!addon) {
      throw new SheetError(
        `Unknown add-on name "${selector}" in file "${source}". No matching add-on found for this killer.`,
      );
    }
    return [addon];
  }
  if (typeof selector === 'object' && selector !== null) {
    const s = selector as Record<string, unknown>;
    if (s.rarity !== undefined) {
      const idx = rarityToIndex(s.rarity, source);
      return universe.filter((a) => a.rarity === idx);
    }
    if (s.tier !== undefined) {
      const idx = rarityToIndex(s.tier, source);
      return universe.filter((a) => a.rarity === idx);
    }
    throw new SheetError(
      `Unknown group selector ${JSON.stringify(selector)} in file "${source}". ` +
        `Only { rarity: "<name>" } and { tier: <0-4> } are supported.`,
    );
  }
  throw new SheetError(`Invalid selector value ${JSON.stringify(selector)} in file "${source}".`);
}

/**
 * Resolve the allowed power add-ons of one killer. Pure: reads only the catalog.
 * Semantics (legacy): start from `default` (allow = whole universe, deny = empty;
 * missing = deny), remove `deny` matches, then add `allow` matches (allow wins).
 * Reusable by the `builds` command.
 *
 * @param cat         catalog
 * @param killerSlug  dbd-assets killer slug (resolve the YAML text with findKiller first)
 * @param cfg         `{default, allow, deny}` block (null/undefined = defaults)
 * @param source      file path for error messages
 * @returns catalog PowerAddon records in insertion order (unsorted)
 * @throws SheetError for bad `default`, unknown names, bad selectors or a killer without add-ons
 */
export function resolveAddonAllowList(
  cat: Catalog,
  killerSlug: string,
  cfg: AddonSection | null | undefined,
  source: string,
): PowerAddon[] {
  const universe = cat.addonsByKiller.get(killerSlug);
  if (!universe) throw new SheetError(`No add-ons found for killer "${killerSlug}" in dbd-assets.`);
  const find = (name: string) => findPowerAddon(cat, killerSlug, name);

  const def = (cfg?.default as unknown) || 'deny';
  if (def !== 'allow' && def !== 'deny') {
    throw new SheetError(`"default" must be "allow" or "deny" in file "${source}".`);
  }
  const allowed = new Map<string, PowerAddon>();
  if (def === 'allow') for (const a of universe) allowed.set(a.slug, a);

  for (const sel of cfg?.deny ?? []) {
    for (const a of matchSelector(sel, universe, find, source)) allowed.delete(a.slug);
  }
  for (const sel of cfg?.allow ?? []) {
    for (const a of matchSelector(sel, universe, find, source)) allowed.set(a.slug, a);
  }
  return [...allowed.values()];
}
