import { createCanvas, type Canvas } from '@napi-rs/canvas';
import type { ItemAddon, ItemVariant, Killer } from '../assets/catalog.js';
import { drawIconOrPlaceholder, itemAddonImagePath, itemVariantImagePath, killerPortraitPath } from '../assets/images.js';
import type { ItemTypeSelection } from '../rules/item-allowlist.js';
import {
  itemDuplicateRuleText,
  itemPickRuleText,
  type ClassifiedItemLimits,
  type ItemLimit,
} from '../rules/item-limits.js';
import { drawSheetHeader, measureSheetHeader, type HeaderLine, type SheetHeaderSpec } from './header.js';
import { createImageLoader } from './image-loader.js';
import { buildLimitSection, drawLimitSection, type LimitEntry } from './limit-section.js';
import {
  BG_COLOR,
  DIVIDER_COLOR,
  fontPt,
  GREY_888,
  GREY_AAA,
  GREY_BBB,
  registerFonts,
  SHEET_MARGIN,
  TEXT_COLOR,
} from './theme.js';

// Layout constants.
const ITEM_ICON = 96;
const ADDON_ICON = 56;
const GAP = 12;
const ROW_GAP = 16;
const MARGIN = SHEET_MARGIN;
const HEADER_H = 210;
const ROW_H = ITEM_ICON;
const LEGEND_TEXT = 'Each survivor brings one item, chosen from the pool below.';
const TYPE_HEADER_H = 38;
const GROUP_GAP = 14;

/** One item type with at least one allowed variant. */
export interface ItemGroup {
  typeName: string;
  variants: ItemVariant[];
  addons: ItemAddon[];
}

/** Group allowed variants by item type (types with none are skipped), keeping type order. */
export function buildItemGroups(types: ItemTypeSelection[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const { item, variants, addons } of types) {
    if (variants.length === 0) continue;
    groups.push({ typeName: item.name, variants, addons });
  }
  return groups;
}

type BodyElement =
  | { kind: 'header'; typeName: string; y: number }
  | { kind: 'row'; variant: ItemVariant; addons: ItemAddon[]; y: number };

/** Body layout: a type header then one row per variant. y is relative to the body top. */
export function computeBodyLayout(groups: ItemGroup[]): { elements: BodyElement[]; bodyH: number } {
  const elements: BodyElement[] = [];
  let y = 0;
  groups.forEach((g, gi) => {
    if (gi > 0) y += GROUP_GAP;
    elements.push({ kind: 'header', typeName: g.typeName, y });
    y += TYPE_HEADER_H;
    g.variants.forEach((variant, vi) => {
      elements.push({ kind: 'row', variant, addons: g.addons, y });
      y += ROW_H;
      if (vi < g.variants.length - 1) y += ROW_GAP;
    });
  });
  return { elements, bodyH: y };
}

/** Icons-only body layout: rows only, with the group gap widened to GROUP_GAP + ROW_GAP. */
export function computeIconBodyLayout(groups: ItemGroup[]): { elements: BodyElement[]; bodyH: number } {
  const elements: BodyElement[] = [];
  let y = 0;
  groups.forEach((g, gi) => {
    if (gi > 0) y += GROUP_GAP + ROW_GAP;
    g.variants.forEach((variant, vi) => {
      elements.push({ kind: 'row', variant, addons: g.addons, y });
      y += ROW_H;
      if (vi < g.variants.length - 1) y += ROW_GAP;
    });
  });
  return { elements, bodyH: y };
}

interface ItemEntry extends LimitEntry {
  variant: ItemVariant;
}
const toEntry = (variant: ItemVariant): ItemEntry => ({ key: variant.slug, label: variant.name, variant });

/** Layout of one limit section (duplicate or pick); null when there are no rules. */
function buildItemLimitSection(rules: ItemLimit[], ruleTextFn: (r: ItemLimit) => string, measure: Parameters<typeof buildLimitSection>[2]) {
  return buildLimitSection(
    rules.map((r) => ({ scope: r.scope, text: ruleTextFn(r), entries: r.items?.map(toEntry) ?? null })),
    'ALL ITEMS',
    measure,
  );
}

/** A rendered canvas plus descriptions of images that were missing. */
export interface RenderResult {
  canvas: Canvas;
  missing: string[];
}

/** Loads variant / add-on / portrait images, collecting each missing path once into `missing`. */
function makeLoader(assetsRoot: string, missing: string[]) {
  const loader = createImageLoader((m) => missing.push(m));
  const variantSource = (v: ItemVariant) => {
    const filePath = itemVariantImagePath(assetsRoot, v);
    return { filePath, message: `item ${v.name} -> ${filePath}` };
  };
  return {
    variant: (v: ItemVariant) => {
      const s = variantSource(v);
      return loader.load(s.filePath, s.message);
    },
    variantMap: (vs: ItemVariant[]) => loader.loadMap(vs, (v) => v.slug, variantSource),
    addon: (a: ItemAddon) => {
      const filePath = itemAddonImagePath(assetsRoot, a);
      return loader.load(filePath, `add-on ${a.name} -> ${filePath}`);
    },
    portrait: (k: Killer) => {
      const filePath = killerPortraitPath(assetsRoot, k.slug);
      return loader.load(filePath, `${k.name} portrait -> ${filePath}`);
    },
  };
}

/** Input of {@link renderSheet}. */
export interface ItemSheetInput {
  killer: Killer;
  groups: ItemGroup[];
  limits: ClassifiedItemLimits;
  balancing: string;
  /** `YYYY-MM-DD` shown as "Generated: ...". */
  dateLabel: string;
  assetsRoot: string;
}

/** Render the full item sheet: header, type headers + variant rows with add-on strips, limit sections. */
export async function renderSheet(input: ItemSheetInput): Promise<RenderResult> {
  registerFonts();
  const { killer, groups, balancing, dateLabel, assetsRoot } = input;
  const duplicateLimits = input.limits.duplicate;
  const pickLimits = input.limits.pick;
  const missing: string[] = [];
  const loader = makeLoader(assetsRoot, missing);

  const variantCount = groups.reduce((n, g) => n + g.variants.length, 0);
  const maxAddons = groups.reduce((m, g) => Math.max(m, g.addons.length), 0);
  const bodyLayout = computeBodyLayout(groups);

  const portraitImg = await loader.portrait(killer);

  const addonStripX = MARGIN + ITEM_ICON + GAP;
  const addonStripW = maxAddons > 0 ? maxAddons * (ADDON_ICON + GAP) - GAP : 240;
  const bodyWidth = addonStripX + addonStripW + MARGIN;

  const plural = (n: number, s: string) => `(${n} ${s}${n === 1 ? '' : 's'})`;
  const lines: HeaderLine[] = [
    { text: `Going against: ${killer.name}`, sizePt: 30, weight: 'bold', color: TEXT_COLOR, dy: 0 },
    { text: 'Allowed Items & Add-ons', sizePt: 18, color: TEXT_COLOR, dy: 46 },
    { text: LEGEND_TEXT, sizePt: 14, color: GREY_BBB, dy: 80 },
    { text: `(${variantCount} items)`, sizePt: 16, color: GREY_AAA, dy: 106 },
  ];
  const fixedLines = lines.length;
  let countLineDy = 134;
  for (const [n, singular] of [
    [duplicateLimits.length, 'duplicate limit'],
    [pickLimits.length, 'pick limit'],
  ] as const) {
    if (!n) continue;
    lines.push({ text: plural(n, singular), sizePt: 14, color: GREY_888, dy: countLineDy });
    countLineDy += 22;
  }
  const header: SheetHeaderSpec = { killer, portrait: portraitImg, headerH: HEADER_H, lines, balancing, dateLabel };

  const measure = createCanvas(1, 1).getContext('2d');
  const hl = measureSheetHeader(measure, header);
  const countMaxW = Math.max(0, ...hl.lineWidths.slice(fixedLines));

  const repLayout = buildItemLimitSection(duplicateLimits, itemDuplicateRuleText, measure);
  const pickLayout = buildItemLimitSection(pickLimits, itemPickRuleText, measure);
  const repH = repLayout ? repLayout.height : 0;
  const pickH = pickLayout ? pickLayout.height : 0;
  const repW = repLayout ? repLayout.width : 0;
  const pickW = pickLayout ? pickLayout.width : 0;

  const COUNT_META_GAP = 24;
  const sharedNeed = countMaxW && hl.metaMaxW ? hl.textX + countMaxW + COUNT_META_GAP + hl.metaMaxW + MARGIN : 0;

  const width = Math.ceil(Math.max(bodyWidth, hl.leftNeed, hl.metaNeed, sharedNeed, repW, pickW));
  const height = HEADER_H + MARGIN + bodyLayout.bodyH + MARGIN + repH + pickH;

  const canvas = createCanvas(width, Math.max(height, HEADER_H + MARGIN * 2 + 40));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawSheetHeader(ctx, header, hl, canvas.width);

  if (variantCount === 0) {
    ctx.fillStyle = GREY_888;
    ctx.font = fontPt(16);
    ctx.fillText('No items allowed', MARGIN, HEADER_H + MARGIN);
    return { canvas, missing };
  }

  // Body
  const bodyTop = HEADER_H + MARGIN;
  for (const el of bodyLayout.elements) {
    const y = bodyTop + el.y;
    if (el.kind === 'header') {
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = fontPt(16, 'bold');
      ctx.textBaseline = 'top';
      ctx.fillText(el.typeName, MARGIN, y);
      ctx.strokeStyle = DIVIDER_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 28);
      ctx.lineTo(width - MARGIN, y + 28);
      ctx.stroke();
      continue;
    }
    drawIconOrPlaceholder(ctx, await loader.variant(el.variant), MARGIN, y, ITEM_ICON, ITEM_ICON);

    const ay = y + Math.round((ROW_H - ADDON_ICON) / 2);
    if (el.addons.length === 0) {
      ctx.fillStyle = GREY_888;
      ctx.font = fontPt(13);
      ctx.textBaseline = 'middle';
      ctx.fillText('(no add-ons allowed)', addonStripX, y + ROW_H / 2);
      ctx.textBaseline = 'top';
    } else {
      for (let j = 0; j < el.addons.length; j++) {
        const x = addonStripX + j * (ADDON_ICON + GAP);
        drawIconOrPlaceholder(ctx, await loader.addon(el.addons[j]!), x, ay, ADDON_ICON, ADDON_ICON);
      }
    }
  }

  // Limit sections
  const gridBottom = bodyTop + bodyLayout.bodyH;
  if (repLayout) {
    drawLimitSection(
      ctx, repLayout, gridBottom, await loader.variantMap(duplicateLimits.flatMap((r) => r.items ?? [])), width,
      'Duplicate Limit', 'how many survivors may bring the same item',
    );
  }
  if (pickLayout) {
    drawLimitSection(
      ctx, pickLayout, gridBottom + repH, await loader.variantMap(pickLimits.flatMap((r) => r.items ?? [])), width,
      'Pick Limits', 'how many items you may choose from a group',
    );
  }
  return { canvas, missing };
}

/**
 * Render the `--icons-only` variant: item rows (variant icon + add-on strip) with no text,
 * headers or limits, tightly cropped on a transparent background.
 * @returns null when no variant is allowed
 */
export async function renderIconSheet(
  groups: ItemGroup[],
  assetsRoot: string,
): Promise<RenderResult | null> {
  const variantCount = groups.reduce((n, g) => n + g.variants.length, 0);
  if (variantCount === 0) return null;
  const maxAddons = groups.reduce((m, g) => Math.max(m, g.addons.length), 0);
  const width = maxAddons > 0 ? ITEM_ICON + GAP + (maxAddons * (ADDON_ICON + GAP) - GAP) : ITEM_ICON;
  const bodyLayout = computeIconBodyLayout(groups);

  const canvas = createCanvas(width, bodyLayout.bodyH);
  const ctx = canvas.getContext('2d');
  const missing: string[] = [];
  const loader = makeLoader(assetsRoot, missing);

  for (const el of bodyLayout.elements) {
    if (el.kind !== 'row') continue;
    const vi = await loader.variant(el.variant);
    if (vi) ctx.drawImage(vi, 0, el.y, ITEM_ICON, ITEM_ICON);
    const ay = el.y + Math.round((ROW_H - ADDON_ICON) / 2);
    for (let j = 0; j < el.addons.length; j++) {
      const img = await loader.addon(el.addons[j]!);
      if (img) ctx.drawImage(img, ITEM_ICON + GAP + j * (ADDON_ICON + GAP), ay, ADDON_ICON, ADDON_ICON);
    }
  }
  return { canvas, missing };
}
