import fs from 'node:fs/promises';
import path from 'node:path';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import { BG_COLOR, SCOPE_COLORS, fontPt } from './theme.js';

/** Scope of a limit/ban rule. */
export type Scope = keyof typeof SCOPE_COLORS;

/** Chip label + colour per scope (ported from legacy; items only use duo/team). */
export const SCOPE_META: Record<Scope, { label: string; color: string }> = {
  survivor: { label: 'ONE SURVIVOR', color: SCOPE_COLORS.survivor },
  duo: { label: 'DUO', color: SCOPE_COLORS.duo },
  team: { label: 'WHOLE TEAM', color: SCOPE_COLORS.team },
  build: { label: 'BUILD', color: SCOPE_COLORS.build },
};

/** Begin a rounded-rect path (does not fill/stroke). */
export function roundRectPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Greedy word-wrap under the ctx's current font. Always returns at least one line. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const test = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(test).width > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * Coloured rounded chip with centred bold label (legacy: `700 12pt`, radius 6). Leaves ctx
 * with textAlign 'left' and textBaseline 'top', like the legacy code.
 */
export function drawScopeChip(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  label: string,
): void {
  ctx.fillStyle = color;
  roundRectPath(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = BG_COLOR;
  ctx.font = fontPt(12, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/** Encode the canvas as PNG and write it, creating parent directories. */
export async function savePng(canvas: Canvas, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, await canvas.encode('png'));
}
