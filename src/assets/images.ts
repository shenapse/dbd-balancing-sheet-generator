import path from 'node:path';
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import type { ItemAddon, ItemVariant, Offering, Perk, PowerAddon } from './catalog.js';
import { PORTRAIT_OFFSETS } from './portrait-offsets.js';

const img = (root: string, ...p: string[]) => path.join(root, 'images', ...p);

/** images/perks/<side>/<renamed_from.slug ?? slug>.webp */
export const perkImagePath = (root: string, perk: Perk): string =>
  img(root, 'perks', perk.side, `${perk.imageSlug}.webp`);

/** images/powers/<killer>/addons/<leaf>.webp */
export const powerAddonImagePath = (root: string, a: PowerAddon): string =>
  img(root, 'powers', a.killer, 'addons', `${a.leaf}.webp`);

/** Variant whose leaf equals its item slug -> items/<item>/icon.webp, else items/<item>/variants/<leaf>.webp */
export const itemVariantImagePath = (root: string, v: ItemVariant): string =>
  v.leaf === v.item ? img(root, 'items', v.item, 'icon.webp') : img(root, 'items', v.item, 'variants', `${v.leaf}.webp`);

/** images/items/<item>/addons/<leaf>.webp */
export const itemAddonImagePath = (root: string, a: ItemAddon): string =>
  img(root, 'items', a.item, 'addons', `${a.leaf}.webp`);

/** images/offerings/<slug>.webp */
export const offeringImagePath = (root: string, o: Offering): string => img(root, 'offerings', `${o.slug}.webp`);

/** images/killers/portrait/<slug>.webp — full-body art; also the build sheet's lore background (dbd-assets has no separate lore set). */
export const killerPortraitPath = (root: string, killerSlug: string): string =>
  img(root, 'killers', 'portrait', `${killerSlug}.webp`);

/** images/powers/<killer>/icon.webp */
export const powerIconPath = (root: string, killerSlug: string): string =>
  img(root, 'powers', killerSlug, 'icon.webp');

/** Slots that have generic empty-slot art in dbd-assets. */
export type EmptySlot = 'perk' | 'item' | 'addon' | 'offering';

/** images/ui/empty-slot/<slot>.webp — generic art for an unfilled build slot (not a record). */
export const emptySlotImagePath = (root: string, slot: EmptySlot): string =>
  img(root, 'ui', 'empty-slot', `${slot}.webp`);

const imageCache = new Map<string, Promise<Image | null>>();

/** Load an image once per path; resolves null if the file is missing or undecodable. */
export function loadImageCached(filePath: string): Promise<Image | null> {
  let p = imageCache.get(filePath);
  if (!p) {
    p = loadImage(filePath).catch(() => null);
    imageCache.set(filePath, p);
  }
  return p;
}

/**
 * Draw the top square of a (taller) killer portrait into a size x size box at (dx, dy).
 * Source rect is (0, PORTRAIT_OFFSETS[slug] ?? 0, img.width, img.width).
 */
export function drawPortraitSquare(
  ctx: SKRSContext2D,
  image: Image,
  slug: string,
  dx: number,
  dy: number,
  size: number,
): void {
  const sy = PORTRAIT_OFFSETS[slug] ?? 0;
  ctx.drawImage(image, 0, sy, image.width, image.width, dx, dy, size, size);
}

/** Draw `image` stretched into the box, or a #333333 placeholder rect when null. */
export function drawIconOrPlaceholder(
  ctx: SKRSContext2D,
  image: Image | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (image) {
    ctx.drawImage(image, x, y, w, h);
  } else {
    ctx.fillStyle = '#333333';
    ctx.fillRect(x, y, w, h);
  }
}
