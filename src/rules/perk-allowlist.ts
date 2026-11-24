import { z } from 'zod';
import type { Catalog, Killer, Perk } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findKiller } from '../match/lookup.js';
import {
  classifyLimits,
  comboBansToLimits,
  repetitionLimitsToLimits,
  resolveComboBans,
  resolvePickLimits,
  resolveRepetitionLimits,
  type LimitBuckets,
} from './perk-limits.js';
import { resolveSide, type WarnFn } from './perk-selectors.js';
import { resolveUniverseDecl } from './universe.js';
import { formatZodError, loadYamlFile } from './yaml.js';

export const sideConfigSchema = z
  .looseObject({
    default: z.enum(['allow', 'deny']).nullish(),
    allow: z.array(z.unknown()).nullish(),
    deny: z.array(z.unknown()).nullish(),
  })
  .nullish();

/**
 * Perk-related part of an allow-list YAML. Other top-level keys (addons, items, display, ...,
 * owned by other tools) are tolerated and ignored, exactly like legacy. Limit sections are kept
 * as `unknown` here and validated by the resolvers in perk-limits.ts (which give the legacy
 * path-qualified messages).
 */
export const perkAllowlistSchema = z.looseObject({
  killer: z.string({ error: 'Missing "killer" field (a killer name is required).' }).min(1, 'Missing "killer" field.'),
  balancing: z.unknown().optional(),
  universe: z.unknown().optional(),
  killerPerks: sideConfigSchema,
  survivorPerks: sideConfigSchema,
  survivorComboBans: z.unknown().optional(),
  killerComboBans: z.unknown().optional(),
  survivorRepetitionLimits: z.unknown().optional(),
  survivorPickLimits: z.unknown().optional(),
  killerPickLimits: z.unknown().optional(),
});

/** Fully resolved perk allow-list for one killer. */
export interface PerkAllowlist {
  killer: Killer;
  /** Balancing ruleset label ('' when absent). */
  balancing: string;
  allowedKiller: Perk[];
  allowedSurvivor: Perk[];
  killerBuckets: LimitBuckets;
  survivorBuckets: LimitBuckets;
}

/** Options of {@link resolvePerkAllowlist}. */
export interface PerkAllowlistOptions {
  /** Explicit `--universes-dir`; undefined = walk up from the YAML. */
  universesDir?: string | null | undefined;
  /** Receives non-fatal warnings (moot/vacuous limits). */
  warn: WarnFn;
}

/**
 * Validate and resolve an already-parsed allow-list document.
 * @param doc parsed YAML
 * @param filePath absolute path of the YAML (error messages, universes lookup)
 * @throws SheetError on any authoring error
 */
export function resolvePerkAllowlist(
  cat: Catalog,
  doc: unknown,
  filePath: string,
  opts: PerkAllowlistOptions,
): PerkAllowlist {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new SheetError(`File "${filePath}" does not contain a YAML object.`);
  }
  const parsed = perkAllowlistSchema.safeParse(doc);
  if (!parsed.success) throw new SheetError(formatZodError(filePath, parsed.error));
  const d = parsed.data;

  const killer = findKiller(cat, d.killer);
  if (!killer) {
    throw new SheetError(`Unknown killer "${d.killer}" in file "${filePath}". No matching killer in dbd-assets.`);
  }
  const balancing = d.balancing == null ? '' : String(d.balancing).trim();

  const uKiller = resolveUniverseDecl(cat, d.universe, 'killer', filePath, opts.universesDir);
  const uSurvivor = resolveUniverseDecl(cat, d.universe, 'survivor', filePath, opts.universesDir);
  const allowedKiller = resolveSide(cat, 'killer', d.killerPerks, uKiller, filePath);
  const allowedSurvivor = resolveSide(cat, 'survivor', d.survivorPerks, uSurvivor, filePath);

  const { warn } = opts;
  const survivorLimits = [
    ...comboBansToLimits(resolveComboBans(cat, d.survivorComboBans, 'survivor', allowedSurvivor, filePath, warn)),
    ...repetitionLimitsToLimits(resolveRepetitionLimits(cat, d.survivorRepetitionLimits, allowedSurvivor, filePath, warn)),
    ...resolvePickLimits(cat, d.survivorPickLimits, 'survivor', allowedSurvivor, filePath, warn),
  ];
  const killerLimits = [
    ...comboBansToLimits(resolveComboBans(cat, d.killerComboBans, 'killer', allowedKiller, filePath, warn)),
    ...resolvePickLimits(cat, d.killerPickLimits, 'killer', allowedKiller, filePath, warn),
  ];

  return {
    killer,
    balancing,
    allowedKiller,
    allowedSurvivor,
    survivorBuckets: classifyLimits(survivorLimits, filePath, warn),
    killerBuckets: classifyLimits(killerLimits, filePath, warn),
  };
}

/** Read `filePath` (YAML) and resolve it. @throws SheetError */
export function loadPerkAllowlist(cat: Catalog, filePath: string, opts: PerkAllowlistOptions): PerkAllowlist {
  return resolvePerkAllowlist(cat, loadYamlFile(filePath), filePath, opts);
}
