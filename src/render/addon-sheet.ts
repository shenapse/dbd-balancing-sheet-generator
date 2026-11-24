import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { RARITY, type Killer, type PowerAddon } from '../assets/catalog.js';
import { killerPortraitPath, powerAddonImagePath } from '../assets/images.js';
import { POWER_ADDON_RARITY_COUNT } from '../rules/rarity.js';
import { drawSheetHeader, measureSheetHeader, type SheetHeaderSpec } from './header.js';
import { drawIconGrid } from './icon-grid.js';
import { createImageLoader } from './image-loader.js';
import { BG_COLOR, fontPt, GREY_888, GREY_AAA, registerFonts, SHEET_MARGIN, TEXT_COLOR } from './theme.js';

// Layout constants (legacy addon-sheet-generator).
export const DEFAULT_COLUMNS = 8;
const ICON = 118;
const GAP = 16;
const MARGIN = SHEET_MARGIN;
const HEADER_H = 190;
const LABEL_W = 160;
const SECTION_GAP = 22;

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
  for (let r = 0; r < POWER_ADDON_RARITY_COUNT; r++) {
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

/** Image file and missing-image message of one add-on. */
function addonSource(a: PowerAddon, killer: Killer, assetsRoot: string): { filePath: string; message: string } {
  const filePath = powerAddonImagePath(assetsRoot, a);
  return { filePath, message: `${killer.name} / ${a.name} -> ${filePath}` };
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
  const loader = createImageLoader((m) => missing.push(m));

  const portraitPath = killerPortraitPath(assetsRoot, killer.slug);
  const portrait = await loader.load(portraitPath, `${killer.name} portrait -> ${portraitPath}`);
  const header: SheetHeaderSpec = {
    killer,
    portrait,
    headerH: HEADER_H,
    balancing,
    dateLabel,
    lines: [
      { text: killer.name, sizePt: 30, weight: 'bold', color: TEXT_COLOR, dy: 0 },
      { text: 'Allowed Killer Add-ons', sizePt: 18, color: TEXT_COLOR, dy: 46 },
      { text: `(${count} add-ons)`, sizePt: 16, color: GREY_AAA, dy: 84 },
    ],
  };

  const gridW = columns * ICON + (columns - 1) * GAP;
  const bodyWidth = MARGIN + LABEL_W + GAP + gridW + MARGIN;
  const hl = measureSheetHeader(createCanvas(1, 1).getContext('2d'), header);
  const width = Math.ceil(Math.max(bodyWidth, hl.leftNeed, hl.metaNeed));

  const { laid, bodyH } = layoutSections(sections, columns, HEADER_H + MARGIN);
  const height = HEADER_H + MARGIN + (count > 0 ? bodyH : 0) + MARGIN;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  drawSheetHeader(ctx, header, hl, width);

  if (count === 0) {
    ctx.fillStyle = GREY_888;
    ctx.font = fontPt(16);
    ctx.fillText('None allowed', MARGIN, HEADER_H + MARGIN);
    return { canvas, missing };
  }

  const gridX = MARGIN + LABEL_W + GAP;
  for (const sec of laid) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = fontPt(16, 'bold');
    ctx.textBaseline = 'middle';
    ctx.fillText(RARITY[sec.rarity] ?? String(sec.rarity), MARGIN, sec.y + sec.height / 2, LABEL_W - GAP);
    ctx.textBaseline = 'top';

    const images = await loader.loadMap(sec.addons, (a) => a.slug, (a) => addonSource(a, killer, assetsRoot));
    drawIconGrid(ctx, sec.addons.map((a) => images.get(a.slug) ?? null), {
      x: gridX,
      y: sec.y,
      columns,
      icon: ICON,
      gap: GAP,
      placeholder: true,
    });
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
  const loader = createImageLoader((m) => missing.push(m));
  for (const sec of laid) {
    const images = await loader.loadMap(sec.addons, (a) => a.slug, (a) => addonSource(a, killer, assetsRoot));
    drawIconGrid(ctx, sec.addons.map((a) => images.get(a.slug) ?? null), {
      y: sec.y,
      columns,
      icon: ICON,
      gap: GAP,
      placeholder: false,
    });
  }
  return { canvas, missing };
}
