import { z } from 'zod';
import type { Catalog, PowerAddon } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findPowerAddon } from '../match/lookup.js';
import { applyAllowDeny } from './allow-deny.js';
import { POWER_ADDON_RARITY_COUNT, selectByRarity } from './rarity.js';
import { formatZodError } from './yaml.js';

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
    const rarity = s.rarity !== undefined ? s.rarity : s.tier;
    if (rarity !== undefined) return selectByRarity(universe, rarity, source, POWER_ADDON_RARITY_COUNT);
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

  return applyAllowDeny(universe, cfg, (sel) => matchSelector(sel, universe, find, source), {
    fallbackDefault: 'deny',
    invalidDefaultMessage: `"default" must be "allow" or "deny" in file "${source}".`,
  });
}
