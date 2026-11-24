import fs from 'node:fs';
import path from 'node:path';
import { SheetError } from '../errors.js';

export type Side = 'killer' | 'survivor';

/** Rarity index -> label. Items use 0-5, add-ons 0-4. */
export const RARITY = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Ultra Rare', 'Event'] as const;
export type RarityIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface Killer {
  slug: string;
  name: string;
  /** aliases + abbreviations from aliases/killers.json */
  aliases: string[];
}

export interface Perk {
  slug: string;
  name: string;
  side: Side;
  renamedFrom?: { slug: string; name: string };
  aliases: string[];
  abbreviations: string[];
  /** Slug of the image file: `renamedFrom?.slug ?? slug`. */
  imageSlug: string;
}

export interface PowerAddon {
  /** `<killer>/<leaf>` */
  slug: string;
  killer: string;
  leaf: string;
  name: string;
  rarity: number;
}

export interface ItemVariant {
  /** `<item>/<leaf>` e.g. `flashlight/sport-flashlight` */
  slug: string;
  item: string;
  leaf: string;
  name: string;
  rarity: number;
}

export interface Item {
  slug: string;
  name: string;
  variants: ItemVariant[];
}

export interface ItemAddon {
  /** `<item>/<leaf>` */
  slug: string;
  item: string;
  leaf: string;
  name: string;
  rarity: number;
}

export interface Offering {
  slug: string;
  name: string;
  side: Side;
}

/** All dbd-assets vocabulary the generators need; arrays are in data-file order. */
export interface Catalog {
  root: string;
  killers: Killer[];
  perks: Perk[];
  perksBySide: Record<Side, Perk[]>;
  powerAddons: PowerAddon[];
  addonsByKiller: Map<string, PowerAddon[]>;
  items: Item[];
  itemVariants: ItemVariant[];
  itemAddons: ItemAddon[];
  itemAddonsByItem: Map<string, ItemAddon[]>;
  offerings: Offering[];
  killersBySlug: Map<string, Killer>;
  itemsBySlug: Map<string, Item>;
}

type Json = Record<string, any>;

function readJson(file: string, optional = false): Json {
  if (!fs.existsSync(file)) {
    if (optional) return {};
    throw new SheetError(`dbd-assets data file missing: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
  } catch (e) {
    throw new SheetError(`Cannot parse ${file}: ${(e as Error).message}`);
  }
}

function leafOf(slug: string): string {
  return slug.slice(slug.indexOf('/') + 1);
}

const cache = new Map<string, Catalog>();

/** Load (and cache per root) the typed catalog from `<root>/data`. aliases/*.json are optional. */
export function loadCatalog(root: string): Catalog {
  const key = path.resolve(root);
  const hit = cache.get(key);
  if (hit) return hit;

  const ent = (n: string) => readJson(path.join(key, 'data/entities', `${n}.json`));
  const ali = (n: string) => readJson(path.join(key, 'data/aliases', `${n}.json`), true);
  const aliasesOf = (a: Json, slug: string) => ({
    aliases: [...(a[slug]?.aliases ?? [])] as string[],
    abbreviations: [...(a[slug]?.abbreviations ?? [])] as string[],
  });

  const killerAliases = ali('killers');
  const killers: Killer[] = Object.entries(ent('killers')).map(([slug, r]) => {
    const a = aliasesOf(killerAliases, slug);
    return { slug, name: r.name, aliases: [...a.aliases, ...a.abbreviations] };
  });

  const perksBySide: Record<Side, Perk[]> = { killer: [], survivor: [] };
  for (const side of ['killer', 'survivor'] as const) {
    const al = ali(`perks-${side}`);
    for (const [slug, r] of Object.entries(ent(`perks-${side}`))) {
      const renamedFrom = r.renamed_from
        ? { slug: r.renamed_from.slug as string, name: r.renamed_from.name as string }
        : undefined;
      perksBySide[side].push({
        slug,
        name: r.name,
        side,
        ...(renamedFrom ? { renamedFrom } : {}),
        ...aliasesOf(al, slug),
        imageSlug: renamedFrom?.slug ?? slug,
      });
    }
  }

  const powerAddons: PowerAddon[] = Object.entries(ent('addons-power')).map(([slug, r]) => ({
    slug,
    killer: r.killer,
    leaf: leafOf(slug),
    name: r.name,
    rarity: r.rarity,
  }));
  const addonsByKiller = new Map<string, PowerAddon[]>();
  for (const a of powerAddons) (addonsByKiller.get(a.killer) ?? addonsByKiller.set(a.killer, []).get(a.killer)!).push(a);

  const items: Item[] = Object.entries(ent('items')).map(([slug, r]) => ({
    slug,
    name: r.name,
    variants: Object.entries((r.variants ?? {}) as Json).map(([vs, v]) => ({
      slug: `${slug}/${vs}`,
      item: slug,
      leaf: vs,
      name: v.name,
      rarity: v.rarity,
    })),
  }));

  const itemAddons: ItemAddon[] = Object.entries(ent('addons-item')).map(([slug, r]) => ({
    slug,
    item: r.item,
    leaf: leafOf(slug),
    name: r.name,
    rarity: r.rarity,
  }));
  const itemAddonsByItem = new Map<string, ItemAddon[]>();
  for (const a of itemAddons) (itemAddonsByItem.get(a.item) ?? itemAddonsByItem.set(a.item, []).get(a.item)!).push(a);

  const offerings: Offering[] = Object.entries(ent('offerings')).map(([slug, r]) => ({
    slug,
    name: r.name,
    side: r.side,
  }));

  const catalog: Catalog = {
    root: key,
    killers,
    perks: [...perksBySide.killer, ...perksBySide.survivor],
    perksBySide,
    powerAddons,
    addonsByKiller,
    items,
    itemVariants: items.flatMap((i) => i.variants),
    itemAddons,
    itemAddonsByItem,
    offerings,
    killersBySlug: new Map(killers.map((k) => [k.slug, k])),
    itemsBySlug: new Map(items.map((i) => [i.slug, i])),
  };
  cache.set(key, catalog);
  return catalog;
}
