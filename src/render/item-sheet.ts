import { createCanvas, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ItemAddon, ItemVariant, Killer } from '../assets/catalog.js';
import {
  drawIconOrPlaceholder,
  drawPortraitSquare,
  itemAddonImagePath,
  itemVariantImagePath,
  killerPortraitPath,
  loadImageCached,
} from '../assets/images.js';
import type { ItemTypeSelection } from '../rules/item-allowlist.js';
import {
  itemDuplicateRuleText,
  itemPickRuleText,
  type ClassifiedItemLimits,
  type ItemLimit,
} from '../rules/item-limits.js';
import { drawScopeChip, roundRectPath, SCOPE_META } from './primitives.js';
import {
  BG_COLOR,
  DIVIDER_COLOR,
  GREY_888,
  GREY_AAA,
  GREY_BBB,
  GREY_DDD,
  RULE_TEXT_COLOR,
  SUBTEXT_COLOR,
  TEXT_COLOR,
  font,
  registerFonts,
} from './theme.js';

// Layout constants (legacy item-sheet-generator).
const ITEM_ICON = 96;
const ADDON_ICON = 56;
const GAP = 12;
const ROW_GAP = 16;
const MARGIN = 32;
const HEADER_H = 210;
const ROW_H = ITEM_ICON;
const LEGEND_TEXT = 'Each survivor brings one item, chosen from the pool below.';
const TYPE_HEADER_H = 38;
const GROUP_GAP = 14;
const LIMIT_ICON = 72;
const LIMIT_ICON_GAP = 24;
const LIMIT_NAME_H = 22;
const LIMIT_ROW_GAP = 20;
const LIMIT_SECTION_GAP = 28;
const LIMIT_PILL_H = 34;
const CHIP_W = 156;

const pt = (n: number) => (n * 4) / 3;

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

interface LimitRuleLayout extends ItemLimit {
  meta: { label: string; color: string };
  text: string;
  slots: { item: ItemVariant; slotW: number }[] | null;
  pillW: number;
  contentH: number;
}
interface LimitLayout {
  rules: LimitRuleLayout[];
  width: number;
  height: number;
}

/**
 * Build the layout of one limit section (duplicate or pick): total height and minimum width.
 * @returns null when there are no rules
 */
export function buildLimitLayout(
  rules: ItemLimit[],
  ruleTextFn: (r: ItemLimit) => string,
  measure: SKRSContext2D,
): LimitLayout | null {
  if (rules.length === 0) return null;
  const out: LimitRuleLayout[] = [];
  let width = 0;
  for (const rule of rules) {
    const meta = SCOPE_META[rule.scope];
    const text = ruleTextFn(rule);
    measure.font = font(pt(14));
    const textW = measure.measureText(text).width;
    width = Math.max(width, MARGIN + CHIP_W + 16 + Math.ceil(textW) + MARGIN);

    let slots: LimitRuleLayout['slots'] = null;
    let pillW = 0;
    let contentH: number;
    if (rule.items) {
      measure.font = font(pt(12));
      let rowW = MARGIN * 2;
      slots = rule.items.map((it) => {
        const nameW = measure.measureText(it.name).width;
        const slotW = Math.max(LIMIT_ICON, Math.ceil(nameW) + 8);
        rowW += slotW + LIMIT_ICON_GAP;
        return { item: it, slotW };
      });
      rowW -= LIMIT_ICON_GAP;
      width = Math.max(width, rowW);
      contentH = LIMIT_ICON + LIMIT_NAME_H;
    } else {
      measure.font = font(pt(12), 'bold');
      pillW = Math.ceil(measure.measureText('ALL ITEMS').width) + 28;
      width = Math.max(width, MARGIN * 2 + pillW);
      contentH = LIMIT_PILL_H;
    }
    out.push({ ...rule, meta, text, slots, pillW, contentH });
  }
  let height = LIMIT_SECTION_GAP + 2 + 16 + 40 + 24 + 8;
  for (const r of out) {
    height += 12 + 30 + 10;
    height += r.contentH + LIMIT_ROW_GAP;
  }
  return { rules: out, width, height };
}

/** Draw one limit section starting at `startY`. `icons` maps variant slug -> Image|null. */
export function drawLimitSection(
  ctx: SKRSContext2D,
  layout: LimitLayout,
  startY: number,
  icons: Map<string, Image | null>,
  width: number,
  title: string,
  subtitle: string,
): void {
  let y = startY + LIMIT_SECTION_GAP;
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
  ctx.font = font(pt(22), 'bold');
  ctx.fillText(title, MARGIN, y);
  y += 40;
  ctx.font = font(pt(13));
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.fillText(subtitle, MARGIN, y);
  y += 24 + 8;

  for (const rule of layout.rules) {
    y += 12;
    const chipH = 30;
    drawScopeChip(ctx, MARGIN, y, CHIP_W, chipH, rule.meta.color, rule.meta.label);
    ctx.font = font(pt(14));
    ctx.fillStyle = RULE_TEXT_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(rule.text, MARGIN + CHIP_W + 16, y + chipH / 2);
    ctx.textBaseline = 'top';
    y += chipH + 10;

    if (rule.slots) {
      let x = MARGIN;
      const iconY = y;
      for (const slot of rule.slots) {
        const cx = x + slot.slotW / 2;
        const ix = Math.round(cx - LIMIT_ICON / 2);
        drawIconOrPlaceholder(ctx, icons.get(slot.item.slug) ?? null, ix, iconY, LIMIT_ICON, LIMIT_ICON);
        ctx.font = font(pt(12));
        ctx.fillStyle = GREY_DDD;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(slot.item.name, Math.round(cx), iconY + LIMIT_ICON + 4);
        x += slot.slotW + LIMIT_ICON_GAP;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    } else {
      ctx.fillStyle = DIVIDER_COLOR;
      roundRectPath(ctx, MARGIN, y, rule.pillW, LIMIT_PILL_H, 6);
      ctx.fill();
      ctx.fillStyle = RULE_TEXT_COLOR;
      ctx.font = font(pt(12), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ALL ITEMS', MARGIN + rule.pillW / 2, y + LIMIT_PILL_H / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    y += rule.contentH + LIMIT_ROW_GAP;
  }
}

/** A rendered canvas plus descriptions of images that were missing. */
export interface RenderResult {
  canvas: Canvas;
  missing: string[];
}

/** Loads variant / add-on images, collecting each missing path once. */
function makeLoader(assetsRoot: string, missing: string[]) {
  const seen = new Set<string>();
  const load = async (p: string, what: string): Promise<Image | null> => {
    const img = await loadImageCached(p);
    if (!img && !seen.has(p)) {
      seen.add(p);
      missing.push(`${what} -> ${p}`);
    }
    return img;
  };
  return {
    variant: (v: ItemVariant) => load(itemVariantImagePath(assetsRoot, v), `item ${v.name}`),
    addon: (a: ItemAddon) => load(itemAddonImagePath(assetsRoot, a), `add-on ${a.name}`),
    portrait: (k: Killer) => load(killerPortraitPath(assetsRoot, k.slug), `${k.name} portrait`),
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
  const portraitH = HEADER_H - MARGIN;
  const portraitW = portraitH; // square crop; slot kept when the image is missing
  const textX = MARGIN + portraitW + 16;

  const addonStripX = MARGIN + ITEM_ICON + GAP;
  const addonStripW = maxAddons > 0 ? maxAddons * (ADDON_ICON + GAP) - GAP : 240;
  const bodyWidth = addonStripX + addonStripW + MARGIN;

  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = font(pt(30), 'bold');
  const titleW = measure.measureText(`Going against: ${killer.name}`).width;
  measure.font = font(pt(18));
  const subW = measure.measureText('Allowed Items & Add-ons').width;
  measure.font = font(pt(14));
  const legendW = measure.measureText(LEGEND_TEXT).width;
  measure.font = font(pt(16));
  const countW = measure.measureText(`(${variantCount} items)`).width;
  measure.font = font(pt(14));
  const repCount = duplicateLimits.length;
  const repCountW = repCount
    ? measure.measureText(`(${repCount} duplicate limit${repCount === 1 ? '' : 's'})`).width
    : 0;
  const pickCount = pickLimits.length;
  const pickCountW = pickCount
    ? measure.measureText(`(${pickCount} pick limit${pickCount === 1 ? '' : 's'})`).width
    : 0;
  const leftMaxW = Math.max(titleW, subW, legendW, countW, repCountW, pickCountW);
  measure.font = font(pt(13));
  const genW = measure.measureText(`Generated: ${dateLabel}`).width;
  const balW = balancing ? measure.measureText(`Balancing: ${balancing}`).width : 0;
  const metaMaxW = Math.max(genW, balW);

  const repLayout = buildLimitLayout(duplicateLimits, itemDuplicateRuleText, measure);
  const pickLayout = buildLimitLayout(pickLimits, itemPickRuleText, measure);
  const repH = repLayout ? repLayout.height : 0;
  const pickH = pickLayout ? pickLayout.height : 0;
  const repW = repLayout ? repLayout.width : 0;
  const pickW = pickLayout ? pickLayout.width : 0;

  const leftNeed = textX + leftMaxW + MARGIN;
  const metaNeed = textX + metaMaxW + MARGIN;
  const countMaxW = Math.max(repCountW, pickCountW);
  const COUNT_META_GAP = 24;
  const sharedNeed = countMaxW && metaMaxW ? textX + countMaxW + COUNT_META_GAP + metaMaxW + MARGIN : 0;

  const width = Math.ceil(Math.max(bodyWidth, leftNeed, metaNeed, sharedNeed, repW, pickW));
  const height = HEADER_H + MARGIN + bodyLayout.bodyH + MARGIN + repH + pickH;

  const canvas = createCanvas(width, Math.max(height, HEADER_H + MARGIN * 2 + 40));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header
  if (portraitImg) drawPortraitSquare(ctx, portraitImg, killer.slug, MARGIN, MARGIN, portraitH);
  else drawIconOrPlaceholder(ctx, null, MARGIN, MARGIN, portraitW, portraitH);

  ctx.fillStyle = TEXT_COLOR;
  ctx.textBaseline = 'top';
  ctx.font = font(pt(30), 'bold');
  ctx.fillText(`Going against: ${killer.name}`, textX, MARGIN);

  ctx.font = font(pt(18));
  ctx.fillText('Allowed Items & Add-ons', textX, MARGIN + 46);

  ctx.font = font(pt(14));
  ctx.fillStyle = GREY_BBB;
  ctx.fillText(LEGEND_TEXT, textX, MARGIN + 80);

  ctx.font = font(pt(16));
  ctx.fillStyle = GREY_AAA;
  ctx.fillText(`(${variantCount} items)`, textX, MARGIN + 106);

  let countLineY = MARGIN + 134;
  const drawCountLine = (n: number, singular: string) => {
    ctx.font = font(pt(14));
    ctx.fillStyle = GREY_888;
    ctx.fillText(`(${n} ${singular}${n === 1 ? '' : 's'})`, textX, countLineY);
    countLineY += 22;
  };
  if (repCount) drawCountLine(repCount, 'duplicate limit');
  if (pickCount) drawCountLine(pickCount, 'pick limit');

  ctx.font = font(pt(13));
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const metaRight = canvas.width - MARGIN;
  ctx.fillText(`Generated: ${dateLabel}`, metaRight, HEADER_H);
  if (balancing) ctx.fillText(`Balancing: ${balancing}`, metaRight, HEADER_H - 22);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (variantCount === 0) {
    ctx.fillStyle = GREY_888;
    ctx.font = font(pt(16));
    ctx.fillText('No items allowed', MARGIN, HEADER_H + MARGIN);
    return { canvas, missing };
  }

  // Body
  const bodyTop = HEADER_H + MARGIN;
  for (const el of bodyLayout.elements) {
    const y = bodyTop + el.y;
    if (el.kind === 'header') {
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = font(pt(16), 'bold');
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
      ctx.font = font(pt(13));
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
  const loadIcons = async (rules: ItemLimit[]) => {
    const m = new Map<string, Image | null>();
    for (const v of rules.flatMap((r) => r.items ?? [])) if (!m.has(v.slug)) m.set(v.slug, await loader.variant(v));
    return m;
  };
  if (repLayout) {
    drawLimitSection(
      ctx, repLayout, gridBottom, await loadIcons(duplicateLimits), width,
      'Duplicate Limit', 'how many survivors may bring the same item',
    );
  }
  if (pickLayout) {
    drawLimitSection(
      ctx, pickLayout, gridBottom + repH, await loadIcons(pickLimits), width,
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
