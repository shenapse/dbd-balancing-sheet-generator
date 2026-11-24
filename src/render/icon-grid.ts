import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { drawIconOrPlaceholder } from '../assets/images.js';

/** Geometry of a row-major square icon grid. */
export interface IconGridOptions {
  /** Left edge of the first cell (default 0). */
  x?: number;
  /** Top edge of the first row (default 0). */
  y?: number;
  columns: number;
  /** Cell size in px (icons are square). */
  icon: number;
  gap: number;
  /** true: grey placeholder for a missing image; false: leave the cell transparent. */
  placeholder: boolean;
}

/** Draw `images` left-to-right, top-to-bottom in a grid of `columns` cells per row. */
export function drawIconGrid(ctx: SKRSContext2D, images: readonly (Image | null)[], o: IconGridOptions): void {
  const { x = 0, y = 0, columns, icon, gap } = o;
  images.forEach((img, i) => {
    const cx = x + (i % columns) * (icon + gap);
    const cy = y + Math.floor(i / columns) * (icon + gap);
    if (o.placeholder) drawIconOrPlaceholder(ctx, img, cx, cy, icon, icon);
    else if (img) ctx.drawImage(img, cx, cy, icon, icon);
  });
}
