import type { Catalog, Perk, Side } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { NameIndex } from '../match/lookup.js';

/** Callback used instead of console.warn so callers decide how warnings surface. */
export type WarnFn = (message: string) => void;

/** Universe declaration after expansion: every perk of the side, or an explicit list of perk names. */
export type UniverseList = 'all' | string[];

/** Build a NameIndex over `perks` (canonical name > renamed_from / aliases / abbreviations). */
export function perkNameIndex(perks: Perk[]): NameIndex<Perk> {
  return new NameIndex(
    perks.map((p) => ({
      record: p,
      names: [p.name],
      aliases: [...(p.renamedFrom ? [p.renamedFrom.name] : []), ...p.aliases, ...p.abbreviations],
    })),
    (p) => p.name,
  );
}

const sideIndexCache = new WeakMap<Catalog, Partial<Record<Side, NameIndex<Perk>>>>();

/** Cached index over ALL perks of one side. */
export function sideIndex(cat: Catalog, side: Side): NameIndex<Perk> {
  let m = sideIndexCache.get(cat);
  if (!m) sideIndexCache.set(cat, (m = {}));
  return (m[side] ??= perkNameIndex(cat.perksBySide[side]));
}

/**
 * Throw the "perk exists but is outside the build's universe" authoring error.
 * @throws SheetError always
 */
export function outsideUniverse(name: string, filePath: string): never {
  throw new SheetError(
    `Perk "${name}" in file "${filePath}" is not in this build's perk universe. ` +
      `Add it to the universe or remove it from allow/deny.`,
  );
}

/**
 * Resolve one allow/deny/combo/limit selector to perks.
 *
 * - string: perk name, former name, alias or abbreviation (normalised match).
 * - single-key object `{Boon: "Circle of Healing"}`: the unquoted-colon YAML quirk; rebuilt into
 *   "Boon: Circle of Healing" and looked up.
 * - `{exhaustion: true}` / `{tag: ...}`: no longer supported -> SheetError.
 *
 * @param lookup index over the (possibly narrowed) universe
 * @param sideLookup index over all perks of the side; pass only when the universe is narrowed so
 *   a real perk outside the universe gets its own error
 * @returns exactly one perk
 * @throws SheetError for unknown/ambiguous/outside-universe/invalid selectors
 */
export function matchSelector(
  selector: unknown,
  lookup: NameIndex<Perk>,
  filePath: string,
  sideLookup?: NameIndex<Perk> | null,
): Perk[] {
  if (typeof selector === 'string') {
    const perk = lookup.get(selector);
    if (!perk && sideLookup?.get(selector)) outsideUniverse(selector, filePath);
    if (!perk) {
      throw new SheetError(
        `Unknown perk name "${selector}" in file "${filePath}". No matching perk found on this side.`,
      );
    }
    return [perk];
  }
  if (typeof selector === 'object' && selector !== null && !Array.isArray(selector)) {
    const obj = selector as Record<string, unknown>;
    if (obj['exhaustion'] === true) {
      throw new SheetError(
        `exhaustion selectors are no longer supported; list the perks explicitly (file "${filePath}").`,
      );
    }
    if (typeof obj['tag'] === 'string') {
      throw new SheetError(`tag selectors are no longer supported; list the perks explicitly (file "${filePath}").`);
    }
    const keys = Object.keys(obj);
    const key = keys[0];
    if (keys.length === 1 && key !== undefined) {
      const reconstructed = `${key}: ${String(obj[key])}`;
      const perk = lookup.get(reconstructed);
      if (perk) return [perk];
      if (sideLookup?.get(reconstructed)) outsideUniverse(reconstructed, filePath);
      throw new SheetError(
        `Unknown perk name "${reconstructed}" in file "${filePath}". ` +
          `No matching perk found on this side. ` +
          `If this is a perk name containing a colon, wrap it in quotes in the YAML ` +
          `(e.g. "Boon: Circle of Healing").`,
      );
    }
    throw new SheetError(
      `Unknown group selector ${JSON.stringify(selector)} in file "${filePath}". ` +
        `Group selectors are no longer supported; list the perks explicitly.`,
    );
  }
  throw new SheetError(`Invalid selector value ${JSON.stringify(selector)} in file "${filePath}".`);
}

/** `{ default, allow, deny }` of one side of an allow-list YAML (already shape-validated). */
export interface SideConfig {
  default?: 'allow' | 'deny' | null | undefined;
  allow?: unknown[] | null | undefined;
  deny?: unknown[] | null | undefined;
}

/**
 * Resolve the allowed perks of one side: seed from `default`, apply `deny`, then `allow`
 * (allow wins), all inside the universe.
 *
 * @param universeDecl `'all'` or an explicit list of perk names (see resolveUniverseDecl)
 * @returns allowed perks sorted by name (localeCompare, as legacy)
 * @throws SheetError on unknown perks, perks outside the universe, bad selectors
 */
export function resolveSide(
  cat: Catalog,
  side: Side,
  sideConfig: SideConfig | null | undefined,
  universeDecl: UniverseList | null | undefined,
  filePath: string,
): Perk[] {
  const sideAll = cat.perksBySide[side];
  const full = sideIndex(cat, side);
  let universe: Perk[];
  let lookup: NameIndex<Perk>;
  let sideLookup: NameIndex<Perk> | null;
  if (!universeDecl || universeDecl === 'all') {
    universe = sideAll;
    lookup = full;
    sideLookup = null;
  } else if (Array.isArray(universeDecl)) {
    universe = universeDecl.map((name) => {
      const p = typeof name === 'string' ? full.get(name) : undefined;
      if (!p) throw new SheetError(`Unknown perk "${String(name)}" in universe list in file "${filePath}".`);
      return p;
    });
    lookup = perkNameIndex(universe);
    sideLookup = full;
  } else {
    throw new SheetError(`Invalid universe declaration in file "${filePath}".`);
  }

  const defaultVal = sideConfig?.default ?? 'allow';
  if (defaultVal !== 'allow' && defaultVal !== 'deny') {
    throw new SheetError(`"default" must be "allow" or "deny" in file "${filePath}".`);
  }
  const allowed = new Map<string, Perk>();
  if (defaultVal === 'allow') for (const p of universe) allowed.set(p.slug, p);

  for (const sel of sideConfig?.deny ?? []) {
    for (const p of matchSelector(sel, lookup, filePath, sideLookup)) allowed.delete(p.slug);
  }
  for (const sel of sideConfig?.allow ?? []) {
    for (const p of matchSelector(sel, lookup, filePath, sideLookup)) allowed.set(p.slug, p);
  }
  return [...allowed.values()].sort((a, b) => a.name.localeCompare(b.name));
}
