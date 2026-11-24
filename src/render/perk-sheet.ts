import path from 'node:path';
import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { Killer, Perk, Side } from '../assets/catalog.js';
import { killerPortraitPath, perkImagePath } from '../assets/images.js';
import {
  comboGroupRuleText,
  pickRuleText,
  repetitionRuleText,
  type LimitBuckets,
  type LimitScope,
  type PerkLimit,
} from '../rules/perk-limits.js';
import { drawSheetHeader, measureSheetHeader, type HeaderLine, type SheetHeaderSpec } from './header.js';
import { drawIconGrid } from './icon-grid.js';
import { createImageLoader, type ImageLoader } from './image-loader.js';
import {
  buildLimitSection,
  drawLimitSection,
  drawLimitSlot,
  drawRuleHead,
  drawSectionHead,
  LIMIT_ICON,
  LIMIT_NAME_H,
  LIMIT_ROW_GAP,
  MARGIN,
  RULE_HEAD_H,
  ruleTextWidth,
  SECTION_HEAD_H,
  slotWidth,
  type LimitEntry,
  type LimitSectionLayout,
} from './limit-section.js';
import { savePng, SCOPE_META } from './primitives.js';
import { BG_COLOR, fontPt, GREY_888, GREY_AAA, registerFonts, TEXT_COLOR } from './theme.js';

// Layout constants (legacy perk-sheet-generator.js).
export const DEFAULT_COLUMNS = 8;
const ICON = 118;
const GAP = 16;
const HEADER_H = 190;
const COMBO_PLUS_W = 40;

/** Services the renderer needs; no globals, no console. */
export interface PerkSheetEnv {
  /** dbd-assets root (image paths). */
  assetsRoot: string;
  /** Receives warnings (e.g. missing images). */
  warn: (message: string) => void;
}

type PerkImages = Map<string, Image | null>;

/** One loader per env (= per input file), so a missing file warns once across both sheets. */
const loaders = new WeakMap<PerkSheetEnv, ImageLoader>();
const loaderFor = (env: PerkSheetEnv): ImageLoader => {
  let l = loaders.get(env);
  if (!l) loaders.set(env, (l = createImageLoader(env.warn)));
  return l;
};

const loadPerkImages = (env: PerkSheetEnv, perks: Perk[]): Promise<PerkImages> =>
  loaderFor(env).loadMap(
    perks,
    (p) => p.slug,
    (p) => {
      const filePath = perkImagePath(env.assetsRoot, p);
      return { filePath, message: `missing icon for perk "${p.name}" (${filePath})` };
    },
  );

interface PerkEntry extends LimitEntry {
  perk: Perk;
}
const toEntry = (perk: Perk): PerkEntry => ({ key: perk.slug, label: perk.name, perk });

interface ComboCombo {
  perks: Perk[];
  slots: { entry: PerkEntry; slotW: number }[];
}
interface ComboGroup {
  scope: LimitScope;
  meta: { label: string; color: string };
  combos: ComboCombo[];
  ruleText: string;
}
interface ComboLayout {
  groups: ComboGroup[];
  width: number;
  height: number;
}

type Measure = SKRSContext2D;

/** Layout of the combination-ban section; null when there are no combos. */
export function buildComboLayout(comboBans: PerkLimit[], measure: Measure): ComboLayout | null {
  if (comboBans.length === 0) return null;
  const groups: ComboGroup[] = [];
  for (const cb of comboBans) {
    let g = groups.find((x) => x.scope === cb.scope);
    if (!g) {
      g = { scope: cb.scope, meta: SCOPE_META[cb.scope], combos: [], ruleText: '' };
      groups.push(g);
    }
    g.combos.push({ perks: cb.perks ?? [], slots: [] });
  }
  let width = 0;
  for (const g of groups) {
    g.ruleText = comboGroupRuleText(g.scope, g.combos);
    width = Math.max(width, ruleTextWidth(measure, g.ruleText));
    for (const combo of g.combos) {
      measure.font = fontPt(12);
      const n = combo.perks.length;
      let rowW = MARGIN * 2;
      combo.slots = combo.perks.map((p, i) => {
        const slotW = slotWidth(measure, p.name);
        rowW += slotW;
        if (i < n - 1) rowW += COMBO_PLUS_W;
        return { entry: toEntry(p), slotW };
      });
      width = Math.max(width, rowW);
    }
  }
  let height = SECTION_HEAD_H;
  for (const g of groups) {
    height += RULE_HEAD_H;
    height += g.combos.length * (LIMIT_ICON + LIMIT_NAME_H + LIMIT_ROW_GAP);
  }
  return { groups, width, height };
}

/** Layout of the duplicate (repetition) section; null when there are none. */
export function buildRepetitionLayout(limits: PerkLimit[], measure: Measure): LimitSectionLayout<PerkEntry> | null {
  return buildLimitSection(
    limits.map((r) => ({ scope: r.scope, text: repetitionRuleText(r), entries: r.perks?.map(toEntry) ?? null })),
    'ALL PERKS',
    measure,
  );
}

/** Layout of the pick-limit section; null when there are none. */
export function buildPickLayout(picks: PerkLimit[], measure: Measure): LimitSectionLayout<PerkEntry> | null {
  return buildLimitSection(
    picks.map((r) => ({ scope: r.scope, text: pickRuleText(r), entries: (r.perks ?? []).map(toEntry) })),
    'ALL PERKS',
    measure,
  );
}

function drawComboSection(ctx: SKRSContext2D, layout: ComboLayout, startY: number, images: PerkImages, width: number): void {
  let y = drawSectionHead(
    ctx,
    startY,
    width,
    'Combination Bans',
    'each perk is allowed on its own — these pairings are restricted',
  );
  for (const g of layout.groups) {
    y = drawRuleHead(ctx, y, g.meta, g.ruleText);
    for (const combo of g.combos) {
      let x = MARGIN;
      combo.slots.forEach((slot, i) => {
        drawLimitSlot(ctx, slot.entry.label, images.get(slot.entry.key) ?? null, slot.slotW, x, y);
        x += slot.slotW;
        if (i < combo.slots.length - 1) {
          ctx.font = fontPt(24, 'bold');
          ctx.fillStyle = GREY_888;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', x + COMBO_PLUS_W / 2, y + LIMIT_ICON / 2);
          x += COMBO_PLUS_W;
        }
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      y += LIMIT_ICON + LIMIT_NAME_H + LIMIT_ROW_GAP;
    }
  }
}

/** Arguments of {@link renderSheet}. */
export interface RenderSheetArgs {
  killer: Killer;
  perks: Perk[];
  side: Side;
  columns: number;
  outDir: string;
  /** Filename stem, e.g. `The-Trapper`. */
  killerSlug: string;
  balancing: string;
  /** `YYYY-MM-DD` shown as "Generated:". */
  dateLabel: string;
  limits: LimitBuckets;
}

const sideLabelOf = (side: Side): string => (side === 'killer' ? 'Allowed Killer Perks' : 'Allowed Survivor Perks');

/** Render the full perk sheet to `<outDir>/<killerSlug>-<side>-perks.png`; returns the path. */
export async function renderSheet(env: PerkSheetEnv, a: RenderSheetArgs): Promise<string> {
  registerFonts();
  const { killer, perks, side, columns, balancing, dateLabel } = a;
  const duplicateLimits = a.limits.duplicate;
  const pickLimits = a.limits.pick;
  const comboBans = a.limits.combo;

  const count = perks.length;
  const rows = count > 0 ? Math.ceil(count / columns) : 0;
  const gridW = columns * ICON + (columns - 1) * GAP;
  const gridH = rows > 0 ? rows * ICON + (rows - 1) * GAP : 0;
  const noteH = count === 0 ? 40 : 0;

  const portraitPath = killerPortraitPath(env.assetsRoot, killer.slug);
  const portraitImg = await loaderFor(env).load(portraitPath, `missing portrait for killer "${killer.name}"`);

  const plural = (n: number, s: string) => `(${n} ${s}${n === 1 ? '' : 's'})`;
  const lines: HeaderLine[] = [
    { text: side === 'survivor' ? `Going against: ${killer.name}` : killer.name, sizePt: 30, weight: 'bold', color: TEXT_COLOR, dy: 0 },
    { text: side === 'killer' ? 'Allowed Killer Perks' : 'Allowed Survivor Perks', sizePt: 18, color: TEXT_COLOR, dy: 46 },
    { text: `(${count} perks)`, sizePt: 16, color: GREY_AAA, dy: 84 },
  ];
  let countLineDy = 116;
  for (const [n, singular] of [
    [duplicateLimits.length, 'duplicate limit'],
    [pickLimits.length, 'pick limit'],
    [comboBans.length, 'combination ban'],
  ] as const) {
    if (!n) continue;
    lines.push({ text: plural(n, singular), sizePt: 14, color: GREY_888, dy: countLineDy });
    countLineDy += 24;
  }
  const header: SheetHeaderSpec = { killer, portrait: portraitImg, headerH: HEADER_H, lines, balancing, dateLabel };

  const measure = createCanvas(1, 1).getContext('2d');
  const hl = measureSheetHeader(measure, header);
  const repLayout = buildRepetitionLayout(duplicateLimits, measure);
  const pickLayout = buildPickLayout(pickLimits, measure);
  const comboLayout = buildComboLayout(comboBans, measure);
  const repH = repLayout?.height ?? 0;
  const pickH = pickLayout?.height ?? 0;
  const comboH = comboLayout?.height ?? 0;

  const bodyWidth = MARGIN * 2 + gridW;
  const width = Math.ceil(
    Math.max(bodyWidth, hl.leftNeed, hl.metaNeed, repLayout?.width ?? 0, pickLayout?.width ?? 0, comboLayout?.width ?? 0),
  );
  const height = HEADER_H + noteH + gridH + MARGIN * 2 + repH + pickH + comboH;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  drawSheetHeader(ctx, header, hl, width);

  if (count === 0) {
    ctx.fillStyle = GREY_888;
    ctx.font = fontPt(16);
    ctx.fillText('None allowed', MARGIN, HEADER_H + MARGIN);
  } else {
    const images = await loadPerkImages(env, perks);
    drawIconGrid(ctx, perks.map((p) => images.get(p.slug) ?? null), {
      x: MARGIN,
      y: HEADER_H + MARGIN,
      columns,
      icon: ICON,
      gap: GAP,
      placeholder: true,
    });
  }

  const gridBottom = HEADER_H + MARGIN + noteH + gridH;
  if (repLayout) {
    const images = await loadPerkImages(env, duplicateLimits.flatMap((r) => r.perks ?? []));
    drawLimitSection(ctx, repLayout, gridBottom, images, width, 'Duplicate Limit', 'how many survivors may bring the same perk');
  }
  if (pickLayout) {
    const images = await loadPerkImages(env, pickLimits.flatMap((r) => r.perks ?? []));
    drawLimitSection(ctx, pickLayout, gridBottom + repH, images, width, 'Pick Limits', 'how many perks you may choose from a group');
  }
  if (comboLayout) {
    const images = await loadPerkImages(env, comboBans.flatMap((c) => c.perks ?? []));
    drawComboSection(ctx, comboLayout, gridBottom + repH + pickH, images, width);
  }

  const outFile = path.join(a.outDir, `${a.killerSlug}-${side}-perks.png`);
  await savePng(canvas, outFile);
  return outFile;
}

/** Arguments of {@link renderIconSheet}. */
export interface RenderIconSheetArgs {
  perks: Perk[];
  side: Side;
  columns: number;
  outDir: string;
  killerSlug: string;
}

/**
 * Icons-only variant: tightly cropped allowed-perk grid on a transparent background, no text.
 * Missing icons leave a transparent cell (plus a warning). Returns null (writes nothing) when
 * there are no perks.
 */
export async function renderIconSheet(env: PerkSheetEnv, a: RenderIconSheetArgs): Promise<string | null> {
  const { perks, side, columns } = a;
  const count = perks.length;
  if (count === 0) return null;
  const cols = Math.min(count, columns);
  const rows = Math.ceil(count / columns);
  const width = cols * ICON + (cols - 1) * GAP;
  const height = rows * ICON + (rows - 1) * GAP;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const images = await loadPerkImages(env, perks);
  drawIconGrid(ctx, perks.map((p) => images.get(p.slug) ?? null), { columns, icon: ICON, gap: GAP, placeholder: false });
  const outFile = path.join(a.outDir, `${a.killerSlug}-${side}-perks-icons.png`);
  await savePng(canvas, outFile);
  return outFile;
}
