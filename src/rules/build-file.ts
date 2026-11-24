import path from 'node:path';
import { z } from 'zod';
import type {
  Catalog,
  ItemAddon,
  ItemVariant,
  Killer,
  Offering,
  Perk,
  PowerAddon,
  Side,
} from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findItemAddon, findItemVariant, findKiller, findOffering, findPerk, findPerkAnySide, findPowerAddon } from '../match/lookup.js';
import { formatZodError, loadYamlFile } from './yaml.js';

/** Max rows per sheet / perks per row / add-ons per row. */
export const MAX_ROWS = 4;
export const MAX_PERKS = 4;
export const MAX_ADDONS = 2;

/** A killer power add-on (killer sheet) or an item add-on (survivor sheet). */
export type BuildAddon = PowerAddon | ItemAddon;

/** One resolved build row; empty slots are null. */
export interface BuildRow {
  /** Always length 4. */
  perks: (Perk | null)[];
  offering: Offering | null;
  /** Survivor side only. */
  item: ItemVariant | null;
  /** Always length 2. */
  addons: (BuildAddon | null)[];
}

/** A parsed + resolved build file. */
export interface BuildModel {
  isSurvivorSheet: boolean;
  /** Required on the killer side, optional on the survivor side. */
  killer: Killer | null;
  /** Trimmed `balancing:` label, '' if absent. */
  balancing: string;
  /** `title:` override, null if absent. */
  title: string | null;
  rows: BuildRow[];
  filePath: string;
}

/** Top-level shape; field contents are checked by hand for precise messages. */
const buildFileSchema = z.looseObject({
  killer: z.unknown().optional(),
  balancing: z.unknown().optional(),
  title: z.unknown().optional(),
  builds: z.unknown().optional(),
  survivors: z.unknown().optional(),
});

function requireString(value: unknown, label: string, filePath: string): string {
  if (typeof value !== 'string') {
    throw new SheetError(
      `${label} ${JSON.stringify(value)} in file "${filePath}" must be a quoted string. ` +
        `If it contains a colon, wrap it in quotes.`,
    );
  }
  return value;
}

/** Run a lookup that may throw an ambiguity SheetError, naming the file in the message. */
function lookup<T>(filePath: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SheetError) throw new SheetError(`${e.message} (file "${filePath}")`);
    throw e;
  }
}

/**
 * Resolve one perk name against the correct side. Distinguishes an unknown name from a side
 * mismatch (a survivor perk named in a killer `builds:` row, or vice versa).
 */
export function resolveBuildPerk(cat: Catalog, name: unknown, side: Side, filePath: string, context: string): Perk {
  if (typeof name !== 'string') {
    throw new SheetError(
      `Perk entry ${JSON.stringify(name)} (${context}) in file "${filePath}" must be a ` +
        `quoted string. If the name contains a colon, wrap it in quotes ` +
        `(e.g. "Scourge Hook: Pain Resonance").`,
    );
  }
  const perk = lookup(filePath, () => findPerk(cat, side, name));
  if (perk) return perk;
  const other = lookup(filePath, () => findPerkAnySide(cat, name));
  if (other && other.side !== side) {
    throw new SheetError(
      `Perk "${name}" (${context}) in file "${filePath}" is a ` +
        `${other.side} perk and cannot be used in a ${side} build.`,
    );
  }
  throw new SheetError(
    `Unknown perk name "${name}" (${context}) in file "${filePath}". No matching perk found on this side.`,
  );
}

/** Parse + resolve an already-loaded build document. @throws SheetError on any authoring error */
export function parseBuildFile(cat: Catalog, doc: unknown, filePath: string): BuildModel {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SheetError(`File "${filePath}" does not contain a YAML object.`);
  }
  const parsed = buildFileSchema.safeParse(doc);
  if (!parsed.success) throw new SheetError(formatZodError(filePath, parsed.error));
  const d = parsed.data;

  const hasBuilds = d.builds !== undefined;
  const hasSurvivors = d.survivors !== undefined;
  if (hasBuilds === hasSurvivors) {
    throw new SheetError(
      `File "${filePath}" must have exactly one of "builds" (killer side) or ` +
        `"survivors" (survivor side) at the top level, got ${hasBuilds ? 'both' : 'neither'}.`,
    );
  }
  const isSurvivorSheet = hasSurvivors;
  const side: Side = isSurvivorSheet ? 'survivor' : 'killer';

  let killer: Killer | null = null;
  if (!isSurvivorSheet && !d.killer) {
    throw new SheetError(`Missing "killer" field in "${filePath}" (required for a killer build file).`);
  }
  if (d.killer) {
    const text = requireString(d.killer, '"killer"', filePath);
    killer = lookup(filePath, () => findKiller(cat, text)) ?? null;
    if (!killer) {
      throw new SheetError(`Unknown killer "${text}" in file "${filePath}". No matching killer in dbd-assets.`);
    }
  }

  const balancing = d.balancing == null ? '' : String(d.balancing).trim();
  const title = d.title == null ? null : requireString(d.title, '"title"', filePath);

  const sideWord = isSurvivorSheet ? 'survivors' : 'builds';
  const rowsRaw = isSurvivorSheet ? d.survivors : d.builds;
  if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
    throw new SheetError(`"${sideWord}" must be a non-empty list in file "${filePath}".`);
  }
  if (rowsRaw.length > MAX_ROWS) {
    throw new SheetError(`"${sideWord}" has ${rowsRaw.length} rows in file "${filePath}"; at most ${MAX_ROWS} are allowed.`);
  }

  if (!isSurvivorSheet && !cat.addonsByKiller.has(killer!.slug)) {
    throw new SheetError(`No add-ons found for killer "${killer!.name}" in dbd-assets.`);
  }

  const rows = (rowsRaw as unknown[]).map((rowRaw, i): BuildRow => {
    const rowNum = i + 1;
    const label = isSurvivorSheet ? `Survivor ${rowNum}` : `Build ${rowNum}`;
    if (!rowRaw || typeof rowRaw !== 'object' || Array.isArray(rowRaw)) {
      throw new SheetError(`Row ${rowNum} (${label}) in file "${filePath}" must be an object.`);
    }
    const r = rowRaw as Record<string, unknown>;

    // perks: up to 4, no duplicates
    const perksRaw = r['perks'] || [];
    if (!Array.isArray(perksRaw)) throw new SheetError(`"perks" in ${label} (file "${filePath}") must be a list.`);
    if (perksRaw.length > MAX_PERKS) {
      throw new SheetError(`${label} in file "${filePath}" has ${perksRaw.length} perks; at most ${MAX_PERKS} are allowed.`);
    }
    const perks: (Perk | null)[] = [null, null, null, null];
    const seenPerks = new Set<string>();
    perksRaw.forEach((name: unknown, idx) => {
      const perk = resolveBuildPerk(cat, name, side, filePath, `${label}, perk slot ${idx + 1}`);
      if (seenPerks.has(perk.slug)) {
        throw new SheetError(`Duplicate perk "${perk.name}" in ${label} (file "${filePath}").`);
      }
      seenPerks.add(perk.slug);
      perks[idx] = perk;
    });

    // offering: side-aware (requested side first, then any side), optional
    let offering: Offering | null = null;
    if (r['offering'] != null) {
      const name = requireString(r['offering'], `"offering" in ${label}`, filePath);
      offering = lookup(filePath, () => findOffering(cat, side, name)) ?? null;
      if (!offering) throw new SheetError(`Unknown offering "${name}" in ${label} (file "${filePath}").`);
    }

    // item: survivor-only, optional
    if (!isSurvivorSheet && r['item'] != null) {
      throw new SheetError(
        `"item" is not valid in a killer build (${label}, file "${filePath}"); items are survivor-only.`,
      );
    }
    let item: ItemVariant | null = null;
    if (isSurvivorSheet && r['item'] != null) {
      const name = requireString(r['item'], `"item" in ${label}`, filePath);
      item = lookup(filePath, () => findItemVariant(cat, name)) ?? null;
      if (!item) throw new SheetError(`Unknown item "${name}" in ${label} (file "${filePath}").`);
    }

    // addons: up to 2, no duplicates, resolved within the row's own pool
    const addonsRaw = r['addons'] || [];
    if (!Array.isArray(addonsRaw)) throw new SheetError(`"addons" in ${label} (file "${filePath}") must be a list.`);
    if (addonsRaw.length > MAX_ADDONS) {
      throw new SheetError(`${label} in file "${filePath}" has ${addonsRaw.length} add-ons; at most ${MAX_ADDONS} are allowed.`);
    }
    let find: ((name: string) => BuildAddon | undefined) | null = null;
    let owner = '';
    if (isSurvivorSheet) {
      if (addonsRaw.length > 0) {
        if (!item) {
          throw new SheetError(`${label} in file "${filePath}" has "addons" but no "item"; add-ons require an item.`);
        }
        const typeName = cat.itemsBySlug.get(item.item)?.name ?? item.item;
        if (!cat.itemAddonsByItem.get(item.item)?.length) {
          throw new SheetError(
            `"${item.name}" (${typeName}) has no add-ons, but ${label} in file "${filePath}" lists add-ons.`,
          );
        }
        const itemSlug = item.item;
        find = (n) => findItemAddon(cat, itemSlug, n);
        owner = `item "${item.name}"'s`;
      }
    } else {
      const killerSlug = killer!.slug;
      find = (n) => findPowerAddon(cat, killerSlug, n);
      owner = `killer "${killer!.name}"'s`;
    }
    const addons: (BuildAddon | null)[] = [null, null];
    const seenAddons = new Set<string>();
    addonsRaw.forEach((rawName: unknown, idx) => {
      const name = requireString(rawName, `Add-on entry in ${label}`, filePath);
      const addon = lookup(filePath, () => find!(name));
      if (!addon) {
        throw new SheetError(
          `Unknown add-on "${name}" in ${label} (file "${filePath}"); not part of ${owner} add-on pool.`,
        );
      }
      if (seenAddons.has(addon.slug)) {
        throw new SheetError(`Duplicate add-on "${addon.name}" in ${label} (file "${filePath}").`);
      }
      seenAddons.add(addon.slug);
      addons[idx] = addon;
    });

    if (r['survivor'] != null) {
      throw new SheetError(
        `"survivor" is no longer a valid key (${label}, file "${filePath}"); ` +
          `survivor character choice was removed from the build sheet schema.`,
      );
    }
    return { perks, offering, item, addons };
  });

  return { isSurvivorSheet, killer, balancing, title, rows, filePath };
}

/** Read, parse and resolve a build YAML. @throws SheetError */
export function loadBuildFile(cat: Catalog, filePath: string): BuildModel {
  return parseBuildFile(cat, loadYamlFile(filePath), filePath);
}

/**
 * Output file name: `<Killer-Name>-killer-builds`, `<Killer-Name>-survivor-builds`, or
 * `<yaml-basename>-survivor-builds` (killer-less survivor file); `-icons` before `.png` for the
 * icons-only variant.
 */
export function outputFilename(model: BuildModel, iconsOnly: boolean): string {
  let base: string;
  if (!model.isSurvivorSheet) {
    base = `${model.killer!.name.replace(/\s+/g, '-')}-killer-builds`;
  } else if (model.killer) {
    base = `${model.killer.name.replace(/\s+/g, '-')}-survivor-builds`;
  } else {
    base = `${path.basename(model.filePath, path.extname(model.filePath))}-survivor-builds`;
  }
  return iconsOnly ? `${base}-icons.png` : `${base}.png`;
}
