import fs from 'node:fs';
import path from 'node:path';
import type { Catalog, Side } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { load as yamlLoad } from 'js-yaml';
import { loadYamlFile } from './yaml.js';
import { sideIndex, type UniverseList } from './perk-selectors.js';

/** @deprecated alias of {@link loadYamlFile}; kept for existing imports. */
export const readYamlFile = loadYamlFile;

/** Allowed top-level keys of a universe file. */
export const UNIVERSE_FILE_KEYS = ['name', 'description', 'killer', 'survivor'] as const;

/** A loaded universe file: per side `'all'` or canonical perk names. */
export type UniverseFile = Record<Side, UniverseList>;

const fileCache = new WeakMap<Catalog, Map<string, UniverseFile>>();

/**
 * Directory holding universe files: the explicit `--universes-dir`, else the nearest `universes/`
 * directory found walking up from the YAML's directory. Null when none exists.
 */
export function findUniversesDir(explicitDir: string | null | undefined, filePath: string): string | null {
  if (explicitDir) return path.resolve(explicitDir);
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    const candidate = path.join(dir, 'universes');
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* not here, keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load and validate one universe file (cached per catalog + path). Perk names are validated
 * against the side, duplicates rejected, and returned as canonical names.
 * @throws SheetError on unreadable/invalid files, unknown keys, unknown or duplicate perks
 */
export function loadUniverseFile(cat: Catalog, universeFile: string): UniverseFile {
  let cache = fileCache.get(cat);
  if (!cache) fileCache.set(cat, (cache = new Map()));
  const hit = cache.get(universeFile);
  if (hit) return hit;

  let raw: string;
  try {
    raw = fs.readFileSync(universeFile, 'utf8');
  } catch (e) {
    throw new SheetError(`Cannot read universe file "${universeFile}": ${(e as Error).message}`);
  }
  let doc: unknown;
  try {
    doc = yamlLoad(raw);
  } catch (e) {
    throw new SheetError(`YAML parse error in universe file "${universeFile}": ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SheetError(`Universe file "${universeFile}" does not contain a YAML object.`);
  }
  const rec = doc as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!(UNIVERSE_FILE_KEYS as readonly string[]).includes(key)) {
      throw new SheetError(
        `Unknown key "${key}" in universe file "${universeFile}". Allowed keys: ${UNIVERSE_FILE_KEYS.join(', ')}.`,
      );
    }
  }

  const result: UniverseFile = { killer: 'all', survivor: 'all' };
  for (const side of ['killer', 'survivor'] as const) {
    const value = rec[side];
    if (value === undefined || value === 'all') continue;
    if (!Array.isArray(value) || value.length === 0) {
      throw new SheetError(
        `"${side}" in universe file "${universeFile}" must be "all" or a non-empty list of perk names.`,
      );
    }
    const index = sideIndex(cat, side);
    const seen = new Map<string, string>(); // slug -> name as first written
    const names: string[] = [];
    for (const entry of value as unknown[]) {
      if (typeof entry !== 'string') {
        let hint = '';
        const keys = entry && typeof entry === 'object' ? Object.keys(entry) : [];
        const k0 = keys[0];
        if (!Array.isArray(entry) && keys.length === 1 && k0 !== undefined) {
          hint =
            ` If this is a perk name containing a colon, wrap it in quotes ` +
            `(e.g. "${k0}: ${String((entry as Record<string, unknown>)[k0])}").`;
        }
        throw new SheetError(
          `Invalid ${side} entry ${JSON.stringify(entry)} in universe file "${universeFile}": perk names must be strings.${hint}`,
        );
      }
      const perk = index.get(entry);
      if (!perk) throw new SheetError(`Unknown ${side} perk "${entry}" in universe file "${universeFile}".`);
      const prev = seen.get(perk.slug);
      if (prev !== undefined) {
        throw new SheetError(
          `Duplicate ${side} perk "${entry}" in universe file "${universeFile}" (already listed as "${prev}").`,
        );
      }
      seen.set(perk.slug, entry);
      names.push(perk.name);
    }
    result[side] = names;
  }
  cache.set(universeFile, result);
  return result;
}

/**
 * Expand a build YAML's `universe:` declaration for one side into `'all' | string[]`.
 *
 * `decl`: undefined/null (=> all) | a universe id (both sides) | `{ killer?, survivor? }` where each
 * side is `'all'`, a universe id, or an inline list of perk names. `all` is reserved.
 *
 * @param universesDir explicit `--universes-dir`, or null/undefined to auto-discover
 * @throws SheetError for unknown keys, missing universes dir, unknown universe id
 */
export function resolveUniverseDecl(
  cat: Catalog,
  decl: unknown,
  side: Side,
  filePath: string,
  universesDir?: string | null,
): UniverseList {
  let sideDecl: unknown;
  if (decl === undefined || decl === null) {
    return 'all';
  } else if (typeof decl === 'string') {
    sideDecl = decl;
  } else if (typeof decl === 'object' && !Array.isArray(decl)) {
    const rec = decl as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      if (key !== 'killer' && key !== 'survivor') {
        throw new SheetError(
          `Unknown key "${key}" in "universe" in file "${filePath}". Allowed keys: killer, survivor.`,
        );
      }
    }
    sideDecl = rec[side];
    if (sideDecl === undefined || sideDecl === null) return 'all';
  } else {
    throw new SheetError(`Invalid universe declaration in file "${filePath}".`);
  }

  if (sideDecl === 'all') return 'all';
  if (Array.isArray(sideDecl)) return sideDecl as string[];
  if (typeof sideDecl !== 'string') {
    throw new SheetError(`Invalid ${side} universe declaration in file "${filePath}".`);
  }

  const dir = findUniversesDir(universesDir, filePath);
  if (!dir) {
    throw new SheetError(
      `Universe "${sideDecl}" is used in file "${filePath}" but no "universes" directory ` +
        `was found above it. Pass --universes-dir <path>.`,
    );
  }
  let ids: string[];
  try {
    ids = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.slice(0, -'.yaml'.length))
      .filter((id) => id !== 'all')
      .sort();
  } catch (e) {
    throw new SheetError(`Cannot read universes directory "${dir}": ${(e as Error).message}`);
  }
  if (!ids.includes(sideDecl)) {
    throw new SheetError(
      `Unknown universe "${sideDecl}" in file "${filePath}". ` +
        `Available universes in "${dir}": ${ids.length ? ids.join(', ') : '(none)'}.`,
    );
  }
  return loadUniverseFile(cat, path.join(dir, `${sideDecl}.yaml`))[side];
}
