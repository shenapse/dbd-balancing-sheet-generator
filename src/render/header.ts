import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import type { Killer } from '../assets/catalog.js';
import { drawIconOrPlaceholder, drawPortraitSquare } from '../assets/images.js';
import { fontPt, SHEET_MARGIN, SUBTEXT_COLOR } from './theme.js';

const MARGIN = SHEET_MARGIN;
/** Gap between the portrait slot and the header text. */
const PORTRAIT_GAP = 16;
/** Distance between the right-aligned "Balancing:" and "Generated:" lines. */
const META_LINE_H = 22;

/** One left-aligned text line of the header; `dy` is relative to the top margin. */
export interface HeaderLine {
  text: string;
  /** Legacy point size (see theme `pt`). */
  sizePt: number;
  weight?: 'normal' | 'bold';
  color: string;
  dy: number;
}

/** Everything the header needs; shared by the perk, add-on and item sheets. */
export interface SheetHeaderSpec {
  killer: Killer;
  /** Portrait image, or null: the square slot is kept and a placeholder is drawn. */
  portrait: Image | null;
  /** Total header height; the meta block is bottom-aligned to it. */
  headerH: number;
  lines: HeaderLine[];
  /** Ruleset label ('' = no "Balancing:" line). */
  balancing: string;
  /** `YYYY-MM-DD` shown as "Generated:". */
  dateLabel: string;
}

/** Measured header geometry used for the canvas width. */
export interface SheetHeaderLayout {
  portraitH: number;
  /** x of the left text column (right of the portrait slot). */
  textX: number;
  /** Width of each of `spec.lines`, same order. */
  lineWidths: number[];
  /** Width of the widest meta line. */
  metaMaxW: number;
  /** Minimum canvas width for the left text column. */
  leftNeed: number;
  /** Minimum canvas width for the meta column. */
  metaNeed: number;
}

/** Measure the header with `measure` (a scratch context); its font is left changed. */
export function measureSheetHeader(measure: SKRSContext2D, spec: SheetHeaderSpec): SheetHeaderLayout {
  const portraitH = spec.headerH - MARGIN;
  const textX = MARGIN + portraitH + PORTRAIT_GAP; // square slot, kept even when the image is missing
  const lineWidths = spec.lines.map((l) => {
    measure.font = fontPt(l.sizePt, l.weight);
    return measure.measureText(l.text).width;
  });
  measure.font = fontPt(13);
  const genW = measure.measureText(`Generated: ${spec.dateLabel}`).width;
  const balW = spec.balancing ? measure.measureText(`Balancing: ${spec.balancing}`).width : 0;
  const metaMaxW = Math.max(genW, balW);
  return {
    portraitH,
    textX,
    lineWidths,
    metaMaxW,
    leftNeed: textX + Math.max(0, ...lineWidths) + MARGIN,
    metaNeed: textX + metaMaxW + MARGIN,
  };
}

/** Draw portrait (or placeholder), the left text lines and the right-aligned meta block. */
export function drawSheetHeader(
  ctx: SKRSContext2D,
  spec: SheetHeaderSpec,
  layout: SheetHeaderLayout,
  canvasWidth: number,
): void {
  const { killer, portrait } = spec;
  if (portrait) drawPortraitSquare(ctx, portrait, killer.slug, MARGIN, MARGIN, layout.portraitH);
  else drawIconOrPlaceholder(ctx, null, MARGIN, MARGIN, layout.portraitH, layout.portraitH);

  ctx.textBaseline = 'top';
  for (const l of spec.lines) {
    ctx.font = fontPt(l.sizePt, l.weight);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, layout.textX, MARGIN + l.dy);
  }

  ctx.font = fontPt(13);
  ctx.fillStyle = SUBTEXT_COLOR;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const metaRight = canvasWidth - MARGIN;
  ctx.fillText(`Generated: ${spec.dateLabel}`, metaRight, spec.headerH);
  if (spec.balancing) ctx.fillText(`Balancing: ${spec.balancing}`, metaRight, spec.headerH - META_LINE_H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
