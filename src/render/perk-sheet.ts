import path from 'node:path';
import { createCanvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { Killer, Perk, Side } from '../assets/catalog.js';
import {
  drawIconOrPlaceholder,
  drawPortraitSquare,
  killerPortraitPath,
  loadImageCached,
  perkImagePath,
} from '../assets/images.js';
import {
  comboGroupRuleText,
  pickRuleText,
  repetitionRuleText,
  type LimitBuckets,
  type LimitScope,
  type PerkLimit,
} from '../rules/perk-limits.js';
import { BG_COLOR, DIVIDER_COLOR, GREY_888, GREY_AAA, GREY_DDD, RULE_TEXT_COLOR, SUBTEXT_COLOR, TEXT_COLOR, font, registerFonts } from './theme.js';
import { drawScopeChip, roundRectPath, savePng, SCOPE_META } from './primitives.js';

// Layout constants (legacy perk-sheet-generator.js).
export const DEFAULT_COLUMNS = 8;
const ICON = 118;
const GAP = 16;
const MARGIN = 32;
const HEADER_H = 190;
const COMBO_ICON = 72;
const COMBO_PLUS_W = 40;
const COMBO_ROW_GAP = 20;
const COMBO_NAME_H = 22;
const COMBO_SECTION_GAP = 28;
const CHIP_W = 156;
const REP_ICON_GAP = 24;
const REP_PILL_H = 34;

/** Legacy `Npt` font size in px (96 dpi). */
const pt = (n: number): number => (n * 4) / 3;

const F = (sizePt: number, weight: 'normal' | 'bold' = 'normal'): string => font(pt(sizePt), weight);

/** Services the renderer needs; no globals, no console. */
export interface PerkSheetEnv {
  /** dbd-assets root (image paths). */
  assetsRoot: string;
  /** Receives warnings (e.g. missing images). */
  warn: (message: string) => void;
}

type PerkImages = Map<string, Image | null>;

async function loadPerkImages(env: PerkSheetEnv, perks: Perk[]): Promise<PerkImages> {
  const uniq = [...new Map(perks.map((p) => [p.slug, p])).values()];
  const imgs = await Promise.all(uniq.map((p) => loadImageCached(perkImagePath(env.assetsRoot, p))));
  const map: PerkImages = new Map();
  uniq.forEach((p, i) => {
    const img = imgs[i] ?? null;
    if (!img) env.warn(`missing icon for perk "${p.name}" (${perkImagePath(env.assetsRoot, p)})`);
    map.set(p.slug, img);
  });
  return map;
}

interface Slot {
  perk: Perk;
  slotW: number;
}
interface SectionRule {
  scope: LimitScope;
  max: number;
  perks: Perk[] | null;
  meta: { label: string; color: string };
  text: string;
  slots: Slot[] | null;
  pillW: number;
  contentH: number;
}
interface RuleLayout {
  rules: SectionRule[];
  width: number;
  height: number;
}
interface ComboCombo {
  perks: Perk[];
  slots: Slot[];
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

const SECTION_HEAD_H = COMBO_SECTION_GAP + 2 + 16 + 40 + 24 + 8;

type Measure = SKRSContext2D;

function iconSlots(measure: Measure, perks: Perk[]): { slots: Slot[]; rowW: number } {
  measure.font = F(12);
  let rowW = MARGIN * 2;
  const slots = perks.map((p) => {
    const slotW = Math.max(COMBO_ICON, Math.ceil(measure.measureText(p.name).width) + 8);
    rowW += slotW + REP_ICON_GAP;
    return { perk: p, slotW };
  });
  rowW -= REP_ICON_GAP;
  return { slots, rowW };
}

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
    measure.font = F(14);
    g.ruleText = comboGroupRuleText(g.scope, g.combos);
    width = Math.max(width, MARGIN + CHIP_W + 16 + Math.ceil(measure.measureText(g.ruleText).width) + MARGIN);
    for (const combo of g.combos) {
      measure.font = F(12);
      const n = combo.perks.length;
      let rowW = MARGIN * 2;
      combo.slots = combo.perks.map((p, i) => {
        const slotW = Math.max(COMBO_ICON, Math.ceil(measure.measureText(p.name).width) + 8);
        rowW += slotW;
        if (i < n - 1) rowW += COMBO_PLUS_W;
        return { perk: p, slotW };
      });
      width = Math.max(width, rowW);
    }
  }
  let height = SECTION_HEAD_H;
  for (const g of groups) {
    height += 12 + 30 + 10;
    height += g.combos.length * (COMBO_ICON + COMBO_NAME_H + COMBO_ROW_GAP);
  }
  return { groups, width, height };
}

/** Layout of the duplicate (repetition) section; null when there are none. */
export function buildRepetitionLayout(limits: PerkLimit[], measure: Measure): RuleLayout | null {
  if (limits.length === 0) return null;
  const rules: SectionRule[] = [];
  let width = 0;
  for (const rule of limits) {
    const meta = SCOPE_META[rule.scope];
    const text = repetitionRuleText(rule);
    measure.font = F(14);
    width = Math.max(width, MARGIN + CHIP_W + 16 + Math.ceil(measure.measureText(text).width) + MARGIN);
    let slots: Slot[] | null = null;
    let pillW = 0;
    let contentH: number;
    if (rule.perks) {
      const s = iconSlots(measure, rule.perks);
      slots = s.slots;
      width = Math.max(width, s.rowW);
      contentH = COMBO_ICON + COMBO_NAME_H;
    } else {
      measure.font = F(12, 'bold');
      pillW = Math.ceil(measure.measureText('ALL PERKS').width) + 28;
      width = Math.max(width, MARGIN * 2 + pillW);
      contentH = REP_PILL_H;
    }
    rules.push({ scope: rule.scope, max: rule.max, perks: rule.perks, meta, text, slots, pillW, contentH });
  }
  let height = SECTION_HEAD_H;
  for (const r of rules) height += 12 + 30 + 10 + r.contentH + COMBO_ROW_GAP;
  return { rules, width, height };
}

/** Layout of the pick-limit section; null when there are none. */
export function buildPickLayout(picks: PerkLimit[], measure: Measure): RuleLayout | null {
  if (picks.length === 0) return null;
  const rules: SectionRule[] = [];
  let width = 0;
  for (const rule of picks) {
    const meta = SCOPE_META[rule.scope];
    const text = pickRuleText(rule);
    measure.font = F(14);
    width = Math.max(width, MARGIN + CHIP_W + 16 + Math.ceil(measure.measureText(text).width) + MARGIN);
    const s = iconSlots(measure, rule.perks ?? []);
    width = Math.max(width, s.rowW);
    rules.push({
      scope: rule.scope,
      max: rule.max,
      perks: rule.perks,
      meta,
      text,
      slots: s.slots,
      pillW: 0,
      contentH: COMBO_ICON + COMBO_NAME_H,
    });
  }
  let height = SECTION_HEAD_H;
  for (const r of rules) height += 12 + 30 + 10 + r.contentH + COMBO_ROW_GAP;
  return { rules, width, height };
}

/** Divider + title + subtitle shared by the three limit sections. Returns the y after them. */
function drawSectionHead(ctx: SKRSContext2D, startY: number, width: number, title: string, subtitle: string): number {
  let y = startY + COMBO_SECTION_GAP;
  ctx.strokeStyle = DIVIDER_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y + 1);
  ctx.lineTo(width - MARGIN, y + 1);
  ctx.stroke();
  y += 2 + 16;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = F(22, 'bold');
  ctx.fillText(title, MARGIN, y);
  y += 40;
  ctx.font = F(13);
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.fillText(subtitle, MARGIN, y);
  return y + 24 + 8;
}

/** Chip + rule sentence line; returns y of the content row. */
function drawRuleHead(ctx: SKRSContext2D, yIn: number, meta: { label: string; color: string }, text: string): number {
  const y = yIn + 12;
  const chipH = 30;
  drawScopeChip(ctx, MARGIN, y, CHIP_W, chipH, meta.color, meta.label);
  ctx.font = F(14);
  ctx.fillStyle = RULE_TEXT_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, MARGIN + CHIP_W + 16, y + chipH / 2);
  ctx.textBaseline = 'top';
  return y + chipH + 10;
}

function drawSlot(ctx: SKRSContext2D, slot: Slot, x: number, iconY: number, images: PerkImages): void {
  const cx = x + slot.slotW / 2;
  const ix = Math.round(cx - COMBO_ICON / 2);
  drawIconOrPlaceholder(ctx, images.get(slot.perk.slug) ?? null, ix, iconY, COMBO_ICON, COMBO_ICON);
  ctx.font = F(12);
  ctx.fillStyle = GREY_DDD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(slot.perk.name, Math.round(cx), iconY + COMBO_ICON + 4);
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
        drawSlot(ctx, slot, x, y, images);
        x += slot.slotW;
        if (i < combo.slots.length - 1) {
          ctx.font = F(24, 'bold');
          ctx.fillStyle = GREY_888;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('+', x + COMBO_PLUS_W / 2, y + COMBO_ICON / 2);
          x += COMBO_PLUS_W;
        }
      });
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      y += COMBO_ICON + COMBO_NAME_H + COMBO_ROW_GAP;
    }
  }
}

function drawRuleSection(
  ctx: SKRSContext2D,
  layout: RuleLayout,
  startY: number,
  images: PerkImages,
  width: number,
  title: string,
  subtitle: string,
): void {
  let y = drawSectionHead(ctx, startY, width, title, subtitle);
  for (const rule of layout.rules) {
    y = drawRuleHead(ctx, y, rule.meta, rule.text);
    if (rule.slots) {
      let x = MARGIN;
      for (const slot of rule.slots) {
        drawSlot(ctx, slot, x, y, images);
        x += slot.slotW + REP_ICON_GAP;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    } else {
      ctx.fillStyle = DIVIDER_COLOR;
      roundRectPath(ctx, MARGIN, y, rule.pillW, REP_PILL_H, 6);
      ctx.fill();
      ctx.fillStyle = RULE_TEXT_COLOR;
      ctx.font = F(12, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ALL PERKS', MARGIN + rule.pillW / 2, y + REP_PILL_H / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    y += rule.contentH + COMBO_ROW_GAP;
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

  const portraitImg = await loadImageCached(killerPortraitPath(env.assetsRoot, killer.slug));
  if (!portraitImg) env.warn(`missing portrait for killer "${killer.name}"`);
  const portraitH = HEADER_H - MARGIN;
  const portraitW = portraitImg ? portraitH : 0; // square crop
  const textX = portraitImg ? MARGIN + portraitW + 16 : MARGIN;

  const sideLabel = sideLabelOf(side);
  const titleText = side === 'survivor' ? `Going against: ${killer.name}` : killer.name;

  const bodyWidth = MARGIN * 2 + gridW;
  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = F(30, 'bold');
  const titleW = measure.measureText(titleText).width;
  measure.font = F(18);
  const subW = measure.measureText(sideLabel).width;
  measure.font = F(16);
  const countW = measure.measureText(`(${count} perks)`).width;
  measure.font = F(14);
  const plural = (n: number, s: string) => `(${n} ${s}${n === 1 ? '' : 's'})`;
  const repCount = duplicateLimits.length;
  const pickCount = pickLimits.length;
  const comboCount = comboBans.length;
  const repCountW = repCount ? measure.measureText(plural(repCount, 'duplicate limit')).width : 0;
  const pickCountW = pickCount ? measure.measureText(plural(pickCount, 'pick limit')).width : 0;
  const comboCountW = comboCount ? measure.measureText(plural(comboCount, 'combination ban')).width : 0;
  const leftMaxW = Math.max(titleW, subW, countW, repCountW, pickCountW, comboCountW);
  measure.font = F(13);
  const genW = measure.measureText(`Generated: ${dateLabel}`).width;
  const balW = balancing ? measure.measureText(`Balancing: ${balancing}`).width : 0;
  const metaMaxW = Math.max(genW, balW);

  const repLayout = buildRepetitionLayout(duplicateLimits, measure);
  const pickLayout = buildPickLayout(pickLimits, measure);
  const comboLayout = buildComboLayout(comboBans, measure);
  const repH = repLayout?.height ?? 0;
  const pickH = pickLayout?.height ?? 0;
  const comboH = comboLayout?.height ?? 0;

  const leftNeed = textX + leftMaxW + MARGIN;
  const metaNeed = textX + metaMaxW + MARGIN;
  const width = Math.ceil(
    Math.max(bodyWidth, leftNeed, metaNeed, repLayout?.width ?? 0, pickLayout?.width ?? 0, comboLayout?.width ?? 0),
  );
  const height = HEADER_H + noteH + gridH + MARGIN * 2 + repH + pickH + comboH;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Header
  if (portraitImg) drawPortraitSquare(ctx, portraitImg, killer.slug, MARGIN, MARGIN, portraitH);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = F(30, 'bold');
  ctx.textBaseline = 'top';
  ctx.fillText(titleText, textX, MARGIN);
  ctx.font = F(18);
  ctx.fillText(sideLabel, textX, MARGIN + 46);
  ctx.font = F(16);
  ctx.fillStyle = GREY_AAA;
  ctx.fillText(`(${count} perks)`, textX, MARGIN + 84);
  let countLineY = MARGIN + 116;
  const drawCountLine = (n: number, singular: string): void => {
    ctx.font = F(14);
    ctx.fillStyle = GREY_888;
    ctx.fillText(plural(n, singular), textX, countLineY);
    countLineY += 24;
  };
  if (repCount) drawCountLine(repCount, 'duplicate limit');
  if (pickCount) drawCountLine(pickCount, 'pick limit');
  if (comboCount) drawCountLine(comboCount, 'combination ban');

  ctx.font = F(13);
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const metaRight = width - MARGIN;
  ctx.fillText(`Generated: ${dateLabel}`, metaRight, HEADER_H);
  if (balancing) ctx.fillText(`Balancing: ${balancing}`, metaRight, HEADER_H - 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (count === 0) {
    ctx.fillStyle = GREY_888;
    ctx.font = F(16);
    ctx.fillText('None allowed', MARGIN, HEADER_H + MARGIN);
  } else {
    const images = await loadPerkImages(env, perks);
    perks.forEach((p, i) => {
      const x = MARGIN + (i % columns) * (ICON + GAP);
      const y = HEADER_H + MARGIN + Math.floor(i / columns) * (ICON + GAP);
      drawIconOrPlaceholder(ctx, images.get(p.slug) ?? null, x, y, ICON, ICON);
    });
  }

  const gridBottom = HEADER_H + MARGIN + noteH + gridH;
  if (repLayout) {
    const images = await loadPerkImages(env, duplicateLimits.flatMap((r) => r.perks ?? []));
    drawRuleSection(ctx, repLayout, gridBottom, images, width, 'Duplicate Limit', 'how many survivors may bring the same perk');
  }
  if (pickLayout) {
    const images = await loadPerkImages(env, pickLimits.flatMap((r) => r.perks ?? []));
    drawRuleSection(ctx, pickLayout, gridBottom + repH, images, width, 'Pick Limits', 'how many perks you may choose from a group');
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
  perks.forEach((p, i) => {
    const img = images.get(p.slug);
    if (img) ctx.drawImage(img, (i % columns) * (ICON + GAP), Math.floor(i / columns) * (ICON + GAP), ICON, ICON);
  });
  const outFile = path.join(a.outDir, `${a.killerSlug}-${side}-perks-icons.png`);
  await savePng(canvas, outFile);
  return outFile;
}
