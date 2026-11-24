import path from 'node:path';
import { createCanvas, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import {
  itemAddonImagePath,
  itemVariantImagePath,
  emptySlotImagePath,
  killerPortraitPath,
  loadImageCached,
  offeringImagePath,
  perkImagePath,
  powerAddonImagePath,
} from '../assets/images.js';
import type { ItemAddon, PowerAddon } from '../assets/catalog.js';
import type { BuildModel, BuildRow } from '../rules/build-file.js';
import type { BuildViolation } from '../rules/build-rules.js';
import { roundRectPath, wrapText } from './primitives.js';
import {
  BAD_TEXT_COLOR,
  BG_COLOR,
  DIVIDER_COLOR,
  OK_TEXT_COLOR,
  PANEL_COLOR,
  PLACEHOLDER_COLOR,
  RULE_TEXT_COLOR,
  SUBTEXT_COLOR,
  TEXT_COLOR,
  VIOLATION_COLOR,
  font,
  fontPt,
  pt,
  registerFonts,
} from './theme.js';

// Layout constants (legacy build-sheet-generator.js).
const PERK = 118;
const OFFERING = 118;
const ITEM = 88;
const ADDON = 68;
export const CANVAS_W = 1280;
const HEADER_H = 110;
const PANEL_X = 270;
const PANEL_W = 1000;
const PANEL_H = 138;
const PANEL_GAP = 15;
const BOTTOM_MARGIN = 13; // a 4-row, rules-free survivor sheet is exactly 1280x720
const LORE_W = 384;
const LORE_H = 761;
const LORE_ALPHA = 0.8;
const MARGIN = 32; // the Violations section's inset only
const SECTION_GAP = 28;
const VIOL_LINE_H = 26;
const VIOL_MARKER = 20;
const VIOL_MARKER_GAP = 12;

/** Legacy `Npt` font size in px (96 dpi). */
const F = fontPt;

/** x is relative to PANEL_X; the table reproduces upstream's non-uniform gaps. */
const SLOT_X = {
  perk: [20, 148, 276, 404],
  offering: [572],
  item: [740],
  addon: [838, 911],
} as const;

export type SlotKind = 'perk' | 'offering' | 'item' | 'addon';

export interface Slot {
  kind: SlotKind;
  index: number;
  size: number;
  x: number;
  y: number;
}

/**
 * Slots of one build row, left to right: 4 perks | offering | (item, survivor only) | 2 add-ons.
 * Icons are vertically centred on the panel band. The killer row omits the item column but keeps
 * the same x positions, so killer and survivor sheets line up column-for-column.
 */
export function rowSlots(isSurvivor: boolean): { slots: Slot[]; width: number } {
  const slots: Slot[] = [];
  const group = (kind: SlotKind, size: number, xs: readonly number[]): void => {
    xs.forEach((x, index) => slots.push({ kind, index, size, x, y: Math.round((PANEL_H - size) / 2) }));
  };
  group('perk', PERK, SLOT_X.perk);
  group('offering', OFFERING, SLOT_X.offering);
  if (isSurvivor) group('item', ITEM, SLOT_X.item);
  group('addon', ADDON, SLOT_X.addon);
  return { slots, width: PANEL_W };
}

/**
 * Image file a slot draws for one row: the record's icon, or the empty-slot art when the slot is
 * empty. Also returns a label for missing-image warnings.
 */
export function slotIconPath(
  assetsRoot: string,
  isSurvivor: boolean,
  row: BuildRow,
  slot: Slot,
): { file: string; label: string; empty: boolean } {
  switch (slot.kind) {
    case 'perk': {
      const p = row.perks[slot.index];
      return p
        ? { file: perkImagePath(assetsRoot, p), label: `perk "${p.name}"`, empty: false }
        : { file: emptySlotImagePath(assetsRoot, 'perk'), label: 'empty perk slot', empty: true };
    }
    case 'offering': {
      const o = row.offering;
      return o
        ? { file: offeringImagePath(assetsRoot, o), label: `offering "${o.name}"`, empty: false }
        : { file: emptySlotImagePath(assetsRoot, 'offering'), label: 'empty offering slot', empty: true };
    }
    case 'item': {
      const v = row.item;
      return v
        ? { file: itemVariantImagePath(assetsRoot, v), label: `item "${v.name}"`, empty: false }
        : { file: emptySlotImagePath(assetsRoot, 'item'), label: 'empty item slot', empty: true };
    }
    case 'addon': {
      const a = row.addons[slot.index];
      if (!a) return { file: emptySlotImagePath(assetsRoot, 'addon'), label: 'empty add-on slot', empty: true };
      const file = isSurvivor
        ? itemAddonImagePath(assetsRoot, a as ItemAddon)
        : powerAddonImagePath(assetsRoot, a as PowerAddon);
      return { file, label: `add-on "${a.name}"`, empty: false };
    }
  }
}

/** Stroke the violation outline over a slot BOX (not its art). */
function strokeViolationOutline(ctx: SKRSContext2D, x: number, y: number, size: number): void {
  ctx.strokeStyle = VIOLATION_COLOR;
  ctx.lineWidth = 4;
  roundRectPath(ctx, x + 2, y + 2, size - 4, size - 4, 8);
  ctx.stroke();
}

/** Dedupe outline targets by `${rowIndex}:${group}:${index}` across every violation. */
export function buildOutlineSet(violations: BuildViolation[]): Set<string> {
  const set = new Set<string>();
  for (const v of violations) for (const s of v.slots) set.add(`${v.rowIndex}:${s.group}:${s.index}`);
  return set;
}

interface ViolationsLayout {
  title: string;
  subtitle: string;
  entries: { textLines: string[] }[];
  height: number;
}

/** Layout of the "Violations" section; null when there are no violations. */
function buildViolationsLayout(
  violations: BuildViolation[],
  rulesPath: string,
  bodyWidth: number,
  measure: SKRSContext2D,
): ViolationsLayout | null {
  if (!violations.length) return null;
  const title = 'Violations';
  const subtitle = `rules broken by these builds, per ${path.basename(rulesPath)}`;
  const wrapWidth = Math.max(50, bodyWidth - MARGIN * 2 - VIOL_MARKER - VIOL_MARKER_GAP);
  measure.font = F(14);
  const entries = violations.map((v) => ({ textLines: wrapText(measure, v.text, wrapWidth) }));
  const physicalLines = entries.reduce((n, e) => n + e.textLines.length, 0);
  // gap + divider(2) + gap(16) + title(40) + subtitle(24+8), then one VIOL_LINE_H per line.
  const height = SECTION_GAP + 2 + 16 + 40 + 24 + 8 + physicalLines * VIOL_LINE_H;
  return { title, subtitle, entries, height };
}

/** Draw the violations section starting at `startY` (bottom of the row band, excluding BOTTOM_MARGIN). */
function drawViolationsSection(ctx: SKRSContext2D, layout: ViolationsLayout, startY: number, width: number): void {
  let y = startY + SECTION_GAP;
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
  ctx.fillText(layout.title, MARGIN, y);
  y += 40;

  ctx.font = F(13);
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.fillText(layout.subtitle, MARGIN, y);
  y += 24 + 8;

  const textX = MARGIN + VIOL_MARKER + VIOL_MARKER_GAP;
  ctx.font = F(14);
  for (const entry of layout.entries) {
    const markerY = y + Math.round((VIOL_LINE_H - VIOL_MARKER) / 2);
    ctx.fillStyle = VIOLATION_COLOR;
    ctx.fillRect(MARGIN, markerY, VIOL_MARKER, VIOL_MARKER);
    ctx.fillStyle = RULE_TEXT_COLOR;
    for (const line of entry.textLines) {
      ctx.fillText(line, textX, y);
      y += VIOL_LINE_H;
    }
  }
}

/** Services the renderer needs. */
export interface BuildSheetEnv {
  assetsRoot: string;
  /** Receives warnings (missing images). Each distinct message is reported once per call. */
  warn: (message: string) => void;
}

export interface BuildSheetOptions {
  model: BuildModel;
  /** null when `--rules` was not given (no status line, outlines or section). */
  violations: BuildViolation[] | null;
  /** Rules file path (named in the Violations subtitle). */
  rulesPath?: string | undefined;
  /** `YYYY-MM-DD HH:MM:SS` generation stamp. */
  dateStamp: string;
}

interface LoadedIcon {
  r: number;
  slot: Slot;
  image: Image | null;
  empty: boolean;
  label: string;
  file: string;
}

async function loadRowIcons(env: BuildSheetEnv, model: BuildModel, slots: Slot[]): Promise<LoadedIcon[]> {
  const jobs: { r: number; slot: Slot; file: string; label: string; empty: boolean }[] = [];
  model.rows.forEach((row, r) => {
    for (const slot of slots) jobs.push({ r, slot, ...slotIconPath(env.assetsRoot, model.isSurvivorSheet, row, slot) });
  });
  const images = await Promise.all(jobs.map((j) => loadImageCached(j.file)));
  return jobs.map((j, i) => ({ ...j, image: images[i] ?? null }));
}

/** The `YYYY-MM-DD HH:MM:SS` UTC stamp the legacy sheet prints. */
export function formatDateStamp(d: Date = new Date()): string {
  return d.toISOString().replace('T', ' ').replace(/\..+/, '');
}

/**
 * Render the full sheet: fixed 1280-wide canvas, the killer's full-body art bleeding up the left
 * edge (clipped to the row band), translucent per-build panels over it, a compact two-line
 * header, and an optional Violations section. Height is dynamic.
 */
export async function renderSheet(env: BuildSheetEnv, opts: BuildSheetOptions): Promise<Canvas> {
  registerFonts();
  const { model, violations } = opts;
  const isSurvivor = model.isSurvivorSheet;
  const { slots } = rowSlots(isSurvivor);
  const n = model.rows.length;
  const rowBandH = n * PANEL_H + (n - 1) * PANEL_GAP;

  // Lore art = the killer's full-body portrait (dbd-assets has no separate lore set).
  let loreImg: Image | null = null;
  if (model.killer) {
    const file = killerPortraitPath(env.assetsRoot, model.killer.slug);
    loreImg = await loadImageCached(file);
    if (!loreImg) env.warn(`no lore art found for "${model.killer.name}" (${file}); rendering the sheet without it.`);
  }

  const hasRules = violations !== null;

  // Header text plan: a YAML `title:` renders whole; otherwise a prefix + killer name.
  let prefix = '';
  let nameText = '';
  if (!model.title) {
    if (!isSurvivor) {
      prefix = 'Playing as: ';
      nameText = model.killer!.name;
    } else if (model.killer) {
      prefix = 'Going against: ';
      nameText = model.killer.name;
    } else {
      nameText = 'Survivor Builds';
    }
  }

  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = F(24, 'bold');
  const tm = measure.measureText(model.title || nameText);
  const titleH = tm.actualBoundingBoxAscent + tm.actualBoundingBoxDescent;

  const layout = hasRules ? buildViolationsLayout(violations, opts.rulesPath ?? '', CANVAS_W, measure) : null;
  const violationsH = layout ? layout.height : 0;

  const width = CANVAS_W;
  const height = HEADER_H + rowBandH + BOTTOM_MARGIN + violationsH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // 2. Lore art: scaled to LORE_W keeping its aspect ratio, top-aligned, clipped to the legacy
  // 384x761 box and the row band. (Portraits range from ~443x972 to 512x867, so a fixed 384x761
  // draw would distort them.)
  if (loreImg) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_H, LORE_W, Math.min(rowBandH, LORE_H));
    ctx.clip();
    ctx.globalAlpha = LORE_ALPHA;
    ctx.drawImage(loreImg, 0, HEADER_H, LORE_W, (LORE_W * loreImg.height) / loreImg.width);
    ctx.globalAlpha = 1;
    // With a Violations section below, dissolve the last ~90px into the background so the clip
    // does not read as a hard cut across the body (a plain gradient fill, not destination-out).
    if (layout) {
      const fadeH = Math.min(90, rowBandH);
      const fadeTop = HEADER_H + rowBandH - fadeH;
      const gradient = ctx.createLinearGradient(0, fadeTop, 0, HEADER_H + rowBandH);
      gradient.addColorStop(0, 'rgba(16, 15, 22, 0)');
      gradient.addColorStop(1, BG_COLOR);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, fadeTop, LORE_W, fadeH);
    }
    ctx.restore();
  }

  // 3. Translucent per-build panels
  ctx.fillStyle = PANEL_COLOR;
  for (let r = 0; r < n; r++) ctx.fillRect(PANEL_X, HEADER_H + r * (PANEL_H + PANEL_GAP), PANEL_W, PANEL_H);

  // 4. Icons + violation outlines
  const outlines = hasRules ? buildOutlineSet(violations) : null;
  const warned = new Set<string>();
  for (const ic of await loadRowIcons(env, model, slots)) {
    const y = HEADER_H + ic.r * (PANEL_H + PANEL_GAP) + ic.slot.y;
    const x = PANEL_X + ic.slot.x;
    if (ic.image) {
      ctx.drawImage(ic.image, x, y, ic.slot.size, ic.slot.size);
    } else {
      ctx.fillStyle = PLACEHOLDER_COLOR;
      ctx.fillRect(x, y, ic.slot.size, ic.slot.size);
      if (!warned.has(ic.file)) {
        warned.add(ic.file);
        env.warn(`missing image for ${ic.label} (drawn as placeholder): ${ic.file}`);
      }
    }
    if (outlines?.has(`${ic.r}:${ic.slot.kind}:${ic.slot.index}`)) strokeViolationOutline(ctx, x, y, ic.slot.size);
  }

  // 5. Header text, above the art and panels.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = TEXT_COLOR;
  if (model.title) {
    ctx.font = F(24, 'bold');
    ctx.fillText(model.title, 10, 10, width);
  } else {
    ctx.font = F(24);
    ctx.fillText(prefix, 10, 10, width);
    const prefixW = ctx.measureText(prefix).width;
    ctx.font = F(24, 'bold');
    ctx.fillText(nameText, 10 + prefixW, 10, width);
  }
  if (model.balancing) {
    const balancingY = 20 + titleH;
    ctx.font = F(18);
    ctx.fillText('Balancing: ', 10, balancingY, width);
    const balPrefixW = ctx.measureText('Balancing: ').width;
    ctx.font = F(18, 'bold');
    ctx.fillText(model.balancing, 10 + balPrefixW, balancingY, width);
  }
  ctx.font = F(14, 'bold');
  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT_COLOR;
  ctx.fillText(`Image Date: ${opts.dateStamp} UTC`, width - 10, 10, width);
  if (hasRules) {
    const count = violations.length;
    ctx.fillStyle = count === 0 ? OK_TEXT_COLOR : BAD_TEXT_COLOR;
    ctx.fillText(count === 0 ? 'No violations found' : `${count} violation${count === 1 ? '' : 's'} found`, width - 10, 40, width);
  }
  ctx.textAlign = 'left';

  // 6. Violations section
  if (layout) drawViolationsSection(ctx, layout, HEADER_H + rowBandH, width);
  return canvas;
}

/**
 * Render the `--icons-only` variant: just the row strip on a transparent background, cropped to
 * the slots' bounding box. Empty slots still draw the empty-slot art; a genuinely missing icon
 * is skipped (with a warning) instead of drawing the opaque placeholder. Outlines are drawn.
 */
export async function renderIconSheet(
  env: BuildSheetEnv,
  opts: Pick<BuildSheetOptions, 'model' | 'violations'>,
): Promise<Canvas> {
  const { model, violations } = opts;
  const { slots } = rowSlots(model.isSurvivorSheet);
  const n = model.rows.length;

  let minX = Infinity;
  let minY = Infinity;
  let maxRight = -Infinity;
  for (const s of slots) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxRight = Math.max(maxRight, s.x + s.size);
  }
  const width = maxRight - minX;
  const height = n * PANEL_H + (n - 1) * PANEL_GAP - 2 * minY;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const outlines = violations ? buildOutlineSet(violations) : null;
  const warned = new Set<string>();
  for (const ic of await loadRowIcons(env, model, slots)) {
    const y = ic.r * (PANEL_H + PANEL_GAP) + ic.slot.y - minY;
    const x = ic.slot.x - minX;
    if (ic.image) {
      ctx.drawImage(ic.image, x, y, ic.slot.size, ic.slot.size);
    } else if (!warned.has(ic.file)) {
      warned.add(ic.file);
      env.warn(`missing image for ${ic.label} (cell skipped): ${ic.file}`);
    }
    if (outlines?.has(`${ic.r}:${ic.slot.kind}:${ic.slot.index}`)) strokeViolationOutline(ctx, x, y, ic.slot.size);
  }
  return canvas;
}
