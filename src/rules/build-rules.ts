import path from 'node:path';
import { z } from 'zod';
import type { Catalog, Killer } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { findKiller } from '../match/lookup.js';
import { addonSectionSchema, resolveAddonAllowList } from './addon-allowlist.js';
import type { BuildModel, BuildRow } from './build-file.js';
import { itemTypeSchema, resolveItemAllowList } from './item-allowlist.js';
import { sideConfigSchema } from './perk-allowlist.js';
import { resolveComboBans, resolvePickLimits, type ComboBan, type PerkLimit } from './perk-limits.js';
import { resolveSide, type WarnFn } from './perk-selectors.js';
import { resolveUniverseDecl } from './universe.js';
import { formatZodError, loadYamlFile } from './yaml.js';

const selectorList = z.array(z.unknown()).nullish();

/** The parts of an allow-list YAML that `builds --rules` reads (everything else is ignored). */
const rulesFileSchema = z.looseObject({
  killer: z.unknown().optional(),
  universe: z.unknown().optional(),
  killerPerks: sideConfigSchema,
  survivorPerks: sideConfigSchema,
  survivorComboBans: z.unknown().optional(),
  killerComboBans: z.unknown().optional(),
  survivorPickLimits: z.unknown().optional(),
  killerPickLimits: z.unknown().optional(),
  addons: addonSectionSchema.nullish(),
  default: z.unknown().optional(),
  allow: selectorList,
  deny: selectorList,
  items: z.record(z.string(), itemTypeSchema.nullable()).nullish(),
});

/** A parsed + resolved `--rules` file, ready for {@link validateRow}. */
export interface RulesContext {
  /** Absolute path of the rules file. */
  rulesPath: string;
  rulesKiller: Killer | null;
  /** Slugs of allowed perks per side. */
  allowedKillerPerks: Set<string>;
  allowedSurvivorPerks: Set<string>;
  /** Single-build combo bans (killer: all; survivor: scope `survivor` only). */
  killerCombos: ComboBan[];
  survivorCombosBuild: ComboBan[];
  /** Single-build pick limits (killer: all; survivor: scope `survivor` only). */
  killerPickLimits: PerkLimit[];
  survivorPickLimitsBuild: PerkLimit[];
  /** Allowed power add-on slugs of the rules file's killer; null when it names no killer. */
  allowedKillerAddons: Set<string> | null;
  /** Allowed item variant slugs. */
  allowedItemVariants: Set<string>;
  /** item slug -> allowed item add-on slugs. */
  allowedItemAddons: Map<string, Set<string>>;
}

/**
 * Parse + resolve a `--rules` allow-list. Perks, items and their add-ons are killer-independent;
 * power add-ons resolve against the rules file's own killer (checked against each build file's
 * killer in {@link validateModel}).
 * @param warn receives non-fatal warnings (moot / vacuous limits)
 * @throws SheetError on any authoring error in the rules file
 */
export function loadRulesContext(
  cat: Catalog,
  rulesPath: string,
  universesDir: string | null | undefined,
  warn: WarnFn,
): RulesContext {
  const abs = path.resolve(rulesPath);
  const raw = loadYamlFile(abs);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SheetError(`Rules file "${abs}" does not contain a YAML object.`);
  }
  const parsed = rulesFileSchema.safeParse(raw);
  if (!parsed.success) throw new SheetError(formatZodError(abs, parsed.error));
  const doc = parsed.data;

  let rulesKiller: Killer | null = null;
  if (doc.killer != null) {
    rulesKiller = findKiller(cat, String(doc.killer)) ?? null;
    if (!rulesKiller) {
      throw new SheetError(`Unknown killer "${String(doc.killer)}" in rules file "${abs}". No matching killer in dbd-assets.`);
    }
  }

  const uKiller = resolveUniverseDecl(cat, doc.universe, 'killer', abs, universesDir);
  const uSurvivor = resolveUniverseDecl(cat, doc.universe, 'survivor', abs, universesDir);
  const allowedKiller = resolveSide(cat, 'killer', doc.killerPerks, uKiller, abs);
  const allowedSurvivor = resolveSide(cat, 'survivor', doc.survivorPerks, uSurvivor, abs);

  const killerCombos = resolveComboBans(cat, doc.killerComboBans, 'killer', allowedKiller, abs, warn);
  const survivorCombosBuild = resolveComboBans(cat, doc.survivorComboBans, 'survivor', allowedSurvivor, abs, warn).filter(
    (c) => c.scope === 'survivor',
  );
  const killerPickLimits = resolvePickLimits(cat, doc.killerPickLimits, 'killer', allowedKiller, abs, warn);
  const survivorPickLimitsBuild = resolvePickLimits(cat, doc.survivorPickLimits, 'survivor', allowedSurvivor, abs, warn).filter(
    (l) => l.scope === 'survivor',
  );

  let allowedKillerAddons: Set<string> | null = null;
  if (rulesKiller) {
    const section = doc.addons ?? { default: doc.default, allow: doc.allow, deny: doc.deny };
    allowedKillerAddons = new Set(resolveAddonAllowList(cat, rulesKiller.slug, section, abs).map((a) => a.slug));
  }

  const topDefault = (doc.default as unknown) || 'deny';
  if (topDefault !== 'allow' && topDefault !== 'deny') {
    throw new SheetError(`Top-level "default" must be "allow" or "deny" in rules file "${abs}".`);
  }
  const types = resolveItemAllowList(cat, doc.items ?? {}, topDefault, abs);
  const allowedItemVariants = new Set<string>();
  const allowedItemAddons = new Map<string, Set<string>>();
  for (const t of types) {
    for (const v of t.variants) allowedItemVariants.add(v.slug);
    allowedItemAddons.set(t.item.slug, new Set(t.addons.map((a) => a.slug)));
  }

  return {
    rulesPath: abs,
    rulesKiller,
    allowedKillerPerks: new Set(allowedKiller.map((p) => p.slug)),
    allowedSurvivorPerks: new Set(allowedSurvivor.map((p) => p.slug)),
    killerCombos,
    survivorCombosBuild,
    killerPickLimits,
    survivorPickLimitsBuild,
    allowedKillerAddons,
    allowedItemVariants,
    allowedItemAddons,
  };
}

/** Rule kinds, matching legacy. */
export type ViolationKind = 'perk-banned' | 'addon-banned' | 'item-banned' | 'item-addon-banned' | 'combo-ban' | 'pick-limit';

/** Slot group, matching the build-sheet slot kinds that carry an outline. */
export type SlotGroup = 'perk' | 'item' | 'addon';

/** One finding. `slots` locate the offending icon(s) for the outline pass. */
export interface BuildViolation {
  kind: ViolationKind;
  /** 0-based row index. */
  rowIndex: number;
  slots: { group: SlotGroup; index: number }[];
  text: string;
}

/** `"A" and "B"` / `"A", "B" and "C"`. */
export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Diff one row against the rules, pushing onto `violations`. Only individual allow/deny plus
 * the single-build limit families are checked (see docs/builds.md for what is excluded).
 */
export function validateRow(
  cat: Catalog,
  row: BuildRow,
  rowIndex: number,
  model: BuildModel,
  ctx: RulesContext,
  violations: BuildViolation[],
): void {
  const isSurvivorSheet = model.isSurvivorSheet;
  const rowLabel = isSurvivorSheet ? `Survivor ${rowIndex + 1}` : `Build ${rowIndex + 1}`;

  // individual perk bans (side-aware)
  const allowedPerks = isSurvivorSheet ? ctx.allowedSurvivorPerks : ctx.allowedKillerPerks;
  row.perks.forEach((perk, idx) => {
    if (!perk || allowedPerks.has(perk.slug)) return;
    violations.push({
      kind: 'perk-banned',
      rowIndex,
      slots: [{ group: 'perk', index: idx }],
      text: `${rowLabel}: "${perk.name}" is not on the allowed ${isSurvivorSheet ? 'survivor' : 'killer'} perk list.`,
    });
  });

  // killer power add-on bans (killer side only)
  if (!isSurvivorSheet && ctx.allowedKillerAddons) {
    row.addons.forEach((addon, idx) => {
      if (!addon || ctx.allowedKillerAddons!.has(addon.slug)) return;
      violations.push({
        kind: 'addon-banned',
        rowIndex,
        slots: [{ group: 'addon', index: idx }],
        text: `${rowLabel}: "${addon.name}" is not on ${model.killer!.name}'s allowed add-on list.`,
      });
    });
  }

  // item variant + item add-on bans (survivor side only)
  if (isSurvivorSheet && row.item) {
    const itemAllowed = ctx.allowedItemVariants.has(row.item.slug);
    if (!itemAllowed) {
      violations.push({
        kind: 'item-banned',
        rowIndex,
        slots: [{ group: 'item', index: 0 }],
        text: `${rowLabel}: "${row.item.name}" is not on the allowed item list.`,
      });
    }
    // Once the item itself is banned, its add-ons are moot (no second finding).
    if (itemAllowed) {
      const addonSlugs = ctx.allowedItemAddons.get(row.item.item) ?? new Set<string>();
      const typeName = cat.itemsBySlug.get(row.item.item)?.name ?? row.item.item;
      row.addons.forEach((addon, idx) => {
        if (!addon || addonSlugs.has(addon.slug)) return;
        violations.push({
          kind: 'item-addon-banned',
          rowIndex,
          slots: [{ group: 'addon', index: idx }],
          text: `${rowLabel}: "${addon.name}" is not on the allowed ${typeName} add-on list.`,
        });
      });
    }
  }

  // combo bans (single-build scope only)
  for (const combo of isSurvivorSheet ? ctx.survivorCombosBuild : ctx.killerCombos) {
    const slots: BuildViolation['slots'] = [];
    let allPresent = true;
    for (const cp of combo.perks) {
      const idx = row.perks.findIndex((p) => p && p.slug === cp.slug);
      if (idx === -1) {
        allPresent = false;
        break;
      }
      slots.push({ group: 'perk', index: idx });
    }
    if (allPresent) {
      violations.push({
        kind: 'combo-ban',
        rowIndex,
        slots,
        text: `${rowLabel}: may not bring ${joinWithAnd(combo.perks.map((p) => `"${p.name}"`))} together.`,
      });
    }
  }

  // pick limits (single-build scope only)
  for (const limit of isSurvivorSheet ? ctx.survivorPickLimitsBuild : ctx.killerPickLimits) {
    const perks = limit.perks ?? [];
    const slots: BuildViolation['slots'] = [];
    for (const p of perks) {
      const idx = row.perks.findIndex((rp) => rp && rp.slug === p.slug);
      if (idx !== -1) slots.push({ group: 'perk', index: idx });
    }
    if (slots.length > limit.max) {
      violations.push({
        kind: 'pick-limit',
        rowIndex,
        slots,
        text:
          `${rowLabel}: may bring at most ${limit.max} of ${perks.map((p) => `"${p.name}"`).join(', ')}; ` +
          `brought ${slots.length}.`,
      });
    }
  }
}

/**
 * Sort order within a row. Legacy values, kept as-is: addon-banned shares rank 3 with
 * item-addon-banned (they never co-occur: killer vs survivor side).
 */
export const VIOLATION_KIND_ORDER: Record<ViolationKind, number> = {
  'perk-banned': 0,
  'addon-banned': 3,
  'item-banned': 2,
  'item-addon-banned': 3,
  'combo-ban': 4,
  'pick-limit': 4,
};

/**
 * Validate a whole parsed build model. Killer mismatch between the rules file and the build file
 * is a hard error (the power add-on allow-list is per killer); a killer-less survivor file only
 * warns.
 * @returns violations sorted by row, then kind order, then first slot index
 */
export function validateModel(cat: Catalog, model: BuildModel, ctx: RulesContext, warn: WarnFn): BuildViolation[] {
  if (model.killer) {
    if (!ctx.rulesKiller) {
      throw new SheetError(
        `Rules file "${ctx.rulesPath}" has no "killer" field, but build file ` +
          `"${model.filePath}" is for "${model.killer.name}"; a rules file must name the ` +
          `same killer to validate its power add-ons.`,
      );
    } else if (ctx.rulesKiller.slug !== model.killer.slug) {
      throw new SheetError(
        `Killer mismatch: rules file "${ctx.rulesPath}" is for ` +
          `"${ctx.rulesKiller.name}" but build file "${model.filePath}" is for "${model.killer.name}".`,
      );
    }
  } else {
    warn(
      `build file "${model.filePath}" has no killer; skipping killer power ` +
        `add-on validation against rules file "${ctx.rulesPath}".`,
    );
  }

  const violations: BuildViolation[] = [];
  model.rows.forEach((row, i) => validateRow(cat, row, i, model, ctx, violations));
  // Array.prototype.sort is stable, matching legacy.
  violations.sort((a, b) => {
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
    const ao = VIOLATION_KIND_ORDER[a.kind];
    const bo = VIOLATION_KIND_ORDER[b.kind];
    if (ao !== bo) return ao - bo;
    return (a.slots[0]?.index ?? 0) - (b.slots[0]?.index ?? 0);
  });
  return violations;
}
