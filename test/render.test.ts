import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  drawIconOrPlaceholder, drawPortraitSquare, killerPortraitPath, loadImageCached, perkImagePath,
} from '../src/assets/images.js';
import { drawScopeChip, SCOPE_META } from '../src/render/primitives.js';
import { font, registerFonts } from '../src/render/theme.js';
import { cat, root } from './helpers.js';

describe('render smoke', () => {
  it('draws perk icon + cropped portrait to PNG', async () => {
    registerFonts();
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext('2d');
    const perk = cat.perks[0]!;
    drawIconOrPlaceholder(ctx, await loadImageCached(perkImagePath(root, perk)), 0, 0, 100, 100);
    const k = cat.killers[0]!;
    drawPortraitSquare(ctx, (await loadImageCached(killerPortraitPath(root, k.slug)))!, k.slug, 110, 0, 100);
    drawIconOrPlaceholder(ctx, null, 220, 0, 100, 100);
    ctx.font = font(20, 'bold');
    drawScopeChip(ctx, 10, 120, 156, 30, SCOPE_META.duo.color, SCOPE_META.duo.label);
    const png = await canvas.encode('png');
    expect(png.length).toBeGreaterThan(1000);
  });
  it('returns null for missing images', async () => {
    expect(await loadImageCached('/nonexistent.webp')).toBeNull();
  });
});
