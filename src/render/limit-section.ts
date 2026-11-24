import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { drawIconOrPlaceholder } from '../assets/images.js';
import { drawScopeChip, roundRectPath, SCOPE_META, type Scope } from './primitives.js';
import {
  DIVIDER_COLOR,
  fontPt,
  GREY_DDD,
  RULE_TEXT_COLOR,
  SHEET_MARGIN,
  SUBTEXT_COLOR,
  TEXT_COLOR,
} from './theme.js';

/**
 * Limit sections (duplicate limits, pick limits, and the perk sheet's combination bans): a
 * divider + title + subtitle head, then per rule a scope chip with its rule sentence followed by
 * either a row of named icons or an "ALL <NOUNS>" pill. Shared by the perk and item sheets.
 */

export const MARGIN = SHEET_MARGIN;
/** Icon edge of a limit-section icon. */
export const LIMIT_ICON = 72;
/** Horizontal gap between icon slots of one rule. */
export const LIMIT_ICON_GAP = 24;
/** Height reserved for the name label under an icon. */
export const LIMIT_NAME_H = 22;
/** Vertical gap after each rule. */
export const LIMIT_ROW_GAP = 20;
/** Gap above the divider of a section. */
export const LIMIT_SECTION_GAP = 28;
/** Height of the "ALL ..." pill. */
export const LIMIT_PILL_H = 34;
/** Width of the scope chip. */
export const CHIP_W = 156;
const CHIP_H = 30;
const CHIP_TEXT_GAP = 16;

/** Height of a section head (gap, divider, title, subtitle). */
export const SECTION_HEAD_H = LIMIT_SECTION_GAP + 2 + 16 + 40 + 24 + 8;
/** Height of the chip + rule sentence line plus the gap above and below it. */
export const RULE_HEAD_H = 12 + CHIP_H + 10;

/** An icon with a name label. `key` indexes the image map handed to {@link drawLimitSection}. */
export interface LimitEntry {
  key: string;
  label: string;
}

/** One rule to lay out; `entries: null` means "everything" and renders the pill. */
export interface LimitRuleSpec<E extends LimitEntry = LimitEntry> {
  scope: Scope;
  text: string;
  entries: E[] | null;
}

/** An icon slot: the entry plus the width its label needs. */
export interface LimitSlot<E extends LimitEntry = LimitEntry> {
  entry: E;
  slotW: number;
}

/** A laid-out rule. */
export interface LimitRuleLayout<E extends LimitEntry = LimitEntry> {
  meta: { label: string; color: string };
  text: string;
  slots: LimitSlot<E>[] | null;
  pillW: number;
  contentH: number;
}

/** Layout of one section: rules plus total `height` and minimum `width`. */
export interface LimitSectionLayout<E extends LimitEntry = LimitEntry> {
  rules: LimitRuleLayout<E>[];
  pillLabel: string;
  width: number;
  height: number;
}

/** Width needed by the chip + rule sentence line. */
export function ruleTextWidth(measure: SKRSContext2D, text: string): number {
  measure.font = fontPt(14);
  return MARGIN + CHIP_W + CHIP_TEXT_GAP + Math.ceil(measure.measureText(text).width) + MARGIN;
}

/** Width of an icon slot for `label` (the icon, or the label if wider). */
export function slotWidth(measure: SKRSContext2D, label: string): number {
  return Math.max(LIMIT_ICON, Math.ceil(measure.measureText(label).width) + 8);
}

/**
 * Lay out one section.
 * @param pillLabel text of the pill drawn for rules without entries (e.g. "ALL PERKS")
 * @param measure   scratch context (font is changed)
 * @returns null when there are no rules
 */
export function buildLimitSection<E extends LimitEntry>(
  rules: LimitRuleSpec<E>[],
  pillLabel: string,
  measure: SKRSContext2D,
): LimitSectionLayout<E> | null {
  if (rules.length === 0) return null;
  const out: LimitRuleLayout<E>[] = [];
  let width = 0;
  for (const rule of rules) {
    width = Math.max(width, ruleTextWidth(measure, rule.text));
    let slots: LimitSlot<E>[] | null = null;
    let pillW = 0;
    let contentH: number;
    if (rule.entries) {
      measure.font = fontPt(12);
      let rowW = MARGIN * 2;
      slots = rule.entries.map((entry) => {
        const slotW = slotWidth(measure, entry.label);
        rowW += slotW + LIMIT_ICON_GAP;
        return { entry, slotW };
      });
      rowW -= LIMIT_ICON_GAP;
      width = Math.max(width, rowW);
      contentH = LIMIT_ICON + LIMIT_NAME_H;
    } else {
      measure.font = fontPt(12, 'bold');
      pillW = Math.ceil(measure.measureText(pillLabel).width) + 28;
      width = Math.max(width, MARGIN * 2 + pillW);
      contentH = LIMIT_PILL_H;
    }
    out.push({ meta: SCOPE_META[rule.scope], text: rule.text, slots, pillW, contentH });
  }
  let height = SECTION_HEAD_H;
  for (const r of out) height += RULE_HEAD_H + r.contentH + LIMIT_ROW_GAP;
  return { rules: out, pillLabel, width, height };
}

/** Divider + title + subtitle. Returns the y after them. */
export function drawSectionHead(ctx: SKRSContext2D, startY: number, width: number, title: string, subtitle: string): number {
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
  ctx.font = fontPt(22, 'bold');
  ctx.fillText(title, MARGIN, y);
  y += 40;
  ctx.font = fontPt(13);
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.fillText(subtitle, MARGIN, y);
  return y + 24 + 8;
}

/** Scope chip + rule sentence line; returns the y of the content row below it. */
export function drawRuleHead(ctx: SKRSContext2D, yIn: number, meta: { label: string; color: string }, text: string): number {
  const y = yIn + 12;
  drawScopeChip(ctx, MARGIN, y, CHIP_W, CHIP_H, meta.color, meta.label);
  ctx.font = fontPt(14);
  ctx.fillStyle = RULE_TEXT_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, MARGIN + CHIP_W + CHIP_TEXT_GAP, y + CHIP_H / 2);
  ctx.textBaseline = 'top';
  return y + CHIP_H + 10;
}

/** One icon centred in a slot of width `slotW` starting at `x`, with its label underneath. */
export function drawLimitSlot(ctx: SKRSContext2D, label: string, image: Image | null, slotW: number, x: number, iconY: number): void {
  const cx = x + slotW / 2;
  drawIconOrPlaceholder(ctx, image, Math.round(cx - LIMIT_ICON / 2), iconY, LIMIT_ICON, LIMIT_ICON);
  ctx.font = fontPt(12);
  ctx.fillStyle = GREY_DDD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, Math.round(cx), iconY + LIMIT_ICON + 4);
}

/** Draw one section starting at `startY`; `images` maps entry key -> image (null = placeholder). */
export function drawLimitSection<E extends LimitEntry>(
  ctx: SKRSContext2D,
  layout: LimitSectionLayout<E>,
  startY: number,
  images: Map<string, Image | null>,
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
        drawLimitSlot(ctx, slot.entry.label, images.get(slot.entry.key) ?? null, slot.slotW, x, y);
        x += slot.slotW + LIMIT_ICON_GAP;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    } else {
      ctx.fillStyle = DIVIDER_COLOR;
      roundRectPath(ctx, MARGIN, y, rule.pillW, LIMIT_PILL_H, 6);
      ctx.fill();
      ctx.fillStyle = RULE_TEXT_COLOR;
      ctx.font = fontPt(12, 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(layout.pillLabel, MARGIN + rule.pillW / 2, y + LIMIT_PILL_H / 2 + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    y += rule.contentH + LIMIT_ROW_GAP;
  }
}
