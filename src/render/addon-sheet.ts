import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { RARITY, type Killer, type PowerAddon } from '../assets/catalog.js';
import {
  drawIconOrPlaceholder,
  drawPortraitSquare,
  killerPortraitPath,
  loadImageCached,
  powerAddonImagePath,
} from '../assets/images.js';
import { BG_COLOR, GREY_888, GREY_AAA, SUBTEXT_COLOR, TEXT_COLOR, font, registerFonts } from './theme.js';

// Layout constants (legacy addon-sheet-generator).
export const DEFAULT_COLUMNS = 8;
const ICON = 118;
const GAP = 16;
const MARGIN = 32;
const HEADER_H = 190;
const LABEL_W = 160;
const SECTION_GAP = 22;

/** Legacy used `pt` sizes; canvas px = pt * 4/3. */
const pt = (n: number) => (n * 4) / 3;

/** One rarity section of the sheet. */
export interface RaritySection {
  rarity: number;
  addons: PowerAddon[];
}

/**
 * Group add-ons by rarity (Common -> Ultra Rare), sorted by name inside each group; empty
 * rarities are skipped.
 */
export function groupAddonsByRarity(addons: PowerAddon[]): RaritySection[] {
  const sections: RaritySection[] = [];
  for (let r = 0; r < 5; r++) {
    const group = addons.filter((a) => a.rarity === r).sort((a, b) => a.name.localeCompare(b.name));
    if (group.length > 0) sections.push({ rarity: r, addons: group });
  }
  return sections;
}

/** Input shared by both renderers. */
export interface AddonSheetInput {
  killer: Killer;
  /** Allowed add-ons (any order). */
  addons: PowerAddon[];
  columns: number;
  assetsRoot: string;
}

/** A rendered canvas plus descriptions of images that were missing (drawn as placeholder / skipped). */
export interface RenderResult {
  canvas: Canvas;
  missing: string[];
}

interface Laid extends RaritySection {
  rows: number;
  height: number;
  y: number;
}

function layoutSections(sections: RaritySection[], columns: number, top: number): { laid: Laid[]; bodyH: number } {
  let bodyH = 0;
  const laid = sections.map((s, i) => {
    const rows = Math.ceil(s.addons.length / columns);
    const height = rows * ICON + (rows - 1) * GAP;
    const l: Laid = { ...s, rows, height, y: top + bodyH };
    bodyH += height;
    if (i < sections.length - 1) bodyH += SECTION_GAP;
    return l;
  });
  return { laid, bodyH };
}

/**
 * Render the full add-on sheet (header + rarity sections).
 * @param balancing  optional ruleset label shown top-right
 * @param dateLabel  `YYYY-MM-DD` shown as "Generated: ..."
 */
export async function renderSheet(
  input: AddonSheetInput & { balancing: string; dateLabel: string },
): Promise<RenderResult> {
  registerFonts();
  const { killer, addons, columns, assetsRoot, balancing, dateLabel } = input;
  const count = addons.length;
  const sections = groupAddonsByRarity(addons);
  const missing: string[] = [];

  const portraitPath = killerPortraitPath(assetsRoot, killer.slug);
  const portraitImg = await loadImageCached(portraitPath);
  if (!portraitImg) missing.push(`${killer.name} portrait -> ${portraitPath}`);
  // Legacy portraits were square headshots, so the slot is square; the space is kept when missing.
  const portraitH = HEADER_H - MARGIN;
  const portraitW = portraitH;
  const textX = MARGIN + portraitW + 16;

  const gridW = columns * ICON + (columns - 1) * GAP;
  const bodyWidth = MARGIN + LABEL_W + GAP + gridW + MARGIN;

  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = font(pt(30), 'bold');
  const titleW = measure.measureText(killer.name).width;
  measure.font = font(pt(18));
  const subW = measure.measureText('Allowed Killer Add-ons').width;
  measure.font = font(pt(16));
  const countW = measure.measureText(`(${count} add-ons)`).width;
  const leftMaxW = Math.max(titleW, subW, countW);
  measure.font = font(pt(13));
  const genW = measure.measureText(`Generated: ${dateLabel}`).width;
  const balW = balancing ? measure.measureText(`Balancing: ${balancing}`).width : 0;
  const metaMaxW = Math.max(genW, balW);

  const leftNeed = textX + leftMaxW + MARGIN;
  const metaNeed = textX + metaMaxW + MARGIN;
  const width = Math.ceil(Math.max(bodyWidth, leftNeed, metaNeed));

  const { laid, bodyH } = layoutSections(sections, columns, HEADER_H + MARGIN);
  const height = HEADER_H + MARGIN + (count > 0 ? bodyH : 0) + MARGIN;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Header
  if (portraitImg) drawPortraitSquare(ctx, portraitImg, killer.slug, MARGIN, MARGIN, portraitH);
  else drawIconOrPlaceholder(ctx, null, MARGIN, MARGIN, portraitW, portraitH);

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = font(pt(30), 'bold');
  ctx.textBaseline = 'top';
  ctx.fillText(killer.name, textX, MARGIN);

  ctx.font = font(pt(18));
  ctx.fillText('Allowed Killer Add-ons', textX, MARGIN + 46);

  ctx.font = font(pt(16));
  ctx.fillStyle = GREY_AAA;
  ctx.fillText(`(${count} add-ons)`, textX, MARGIN + 84);

  ctx.font = font(pt(13));
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
    ctx.font = font(pt(16));
    ctx.fillText('None allowed', MARGIN, HEADER_H + MARGIN);
    return { canvas, missing };
  }

  const gridX = MARGIN + LABEL_W + GAP;
  for (const sec of laid) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = font(pt(16), 'bold');
    ctx.textBaseline = 'middle';
    ctx.fillText(RARITY[sec.rarity] ?? String(sec.rarity), MARGIN, sec.y + sec.height / 2, LABEL_W - GAP);
    ctx.textBaseline = 'top';

    for (let i = 0; i < sec.addons.length; i++) {
      const a = sec.addons[i]!;
      const x = gridX + (i % columns) * (ICON + GAP);
      const y = sec.y + Math.floor(i / columns) * (ICON + GAP);
      const p = powerAddonImagePath(assetsRoot, a);
      const img = await loadImageCached(p);
      if (!img) missing.push(`${killer.name} / ${a.name} -> ${p}`);
      drawIconOrPlaceholder(ctx, img, x, y, ICON, ICON);
    }
  }
  return { canvas, missing };
}

/**
 * Render the `--icons-only` variant: only the icon grid, tightly cropped, transparent
 * background, rarity sections stacked without labels. Missing icons leave a transparent cell.
 * @returns null when nothing is allowed
 */
export async function renderIconSheet(input: AddonSheetInput): Promise<RenderResult | null> {
  const { addons, columns, assetsRoot, killer } = input;
  if (addons.length === 0) return null;
  const sections = groupAddonsByRarity(addons);

  const cols = Math.min(Math.max(...sections.map((s) => s.addons.length)), columns);
  const width = cols * ICON + (cols - 1) * GAP;
  const { laid, bodyH } = layoutSections(sections, columns, 0);

  const canvas = createCanvas(width, bodyH);
  const ctx = canvas.getContext('2d');
  const missing: string[] = [];
  for (const sec of laid) {
    for (let i = 0; i < sec.addons.length; i++) {
      const a = sec.addons[i]!;
      const x = (i % columns) * (ICON + GAP);
      const y = sec.y + Math.floor(i / columns) * (ICON + GAP);
      const p = powerAddonImagePath(assetsRoot, a);
      const img = await loadImageCached(p);
      if (img) ctx.drawImage(img, x, y, ICON, ICON);
      else missing.push(`${killer.name} / ${a.name} -> ${p}`);
    }
  }
  return { canvas, missing };
}
