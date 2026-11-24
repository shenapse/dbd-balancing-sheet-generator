import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  itemAddonImagePath, itemVariantImagePath, killerPortraitPath, offeringImagePath,
  perkImagePath, powerAddonImagePath, powerIconPath,
} from '../src/assets/images.js';
import { readAssetsRef } from '../src/assets/root.js';
import { cat, root } from './helpers.js';

describe('catalog', () => {
  it('has expected counts', () => {
    expect(cat.killers.length).toBeGreaterThanOrEqual(43);
    expect(cat.perksBySide.killer.length).toBeGreaterThanOrEqual(142);
    expect(cat.perksBySide.survivor.length).toBeGreaterThanOrEqual(171);
    expect(cat.powerAddons.length).toBeGreaterThanOrEqual(859);
    expect(cat.itemAddons.length).toBeGreaterThanOrEqual(54);
    expect(cat.items.length).toBeGreaterThanOrEqual(7);
    expect(cat.itemVariants.length).toBeGreaterThanOrEqual(32);
    expect(cat.offerings.length).toBeGreaterThanOrEqual(27);
  });
  it('maps renamed perks to the old image slug', () => {
    const p = cat.perks.find((x) => x.renamedFrom)!;
    expect(p.imageSlug).toBe(p.renamedFrom!.slug);
  });
  it('reads an assets ref', () => {
    expect(readAssetsRef(root)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('image paths exist', () => {
  const missing = (paths: string[]) => paths.filter((p) => !fs.existsSync(p));
  it('perks', () => expect(missing(cat.perks.map((p) => perkImagePath(root, p)))).toEqual([]));
  it('power add-ons', () => expect(missing(cat.powerAddons.map((a) => powerAddonImagePath(root, a)))).toEqual([]));
  it('item variants', () => expect(missing(cat.itemVariants.map((v) => itemVariantImagePath(root, v)))).toEqual([]));
  it('item add-ons', () => expect(missing(cat.itemAddons.map((a) => itemAddonImagePath(root, a)))).toEqual([]));
  it('offerings', () => expect(missing(cat.offerings.map((o) => offeringImagePath(root, o)))).toEqual([]));
  it('killer portraits', () => expect(missing(cat.killers.map((k) => killerPortraitPath(root, k.slug)))).toEqual([]));
  it('power icons', () => expect(missing(cat.killers.map((k) => powerIconPath(root, k.slug)))).toEqual([]));
});
