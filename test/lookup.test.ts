import { describe, expect, it } from 'vitest';
import { SheetError } from '../src/errors.js';
import {
  NameIndex, findItem, findItemAddon, findItemVariant, findKiller, findOffering, findPerk,
  findPerkAnySide, findPowerAddon,
} from '../src/match/lookup.js';
import { normalize } from '../src/match/normalize.js';
import { cat } from './helpers.js';

describe('normalize', () => {
  it('strips case, spaces and punctuation', () => {
    expect(normalize('Hex: Huntress Lullaby')).toBe('hex:huntresslullaby');
    expect(normalize("Bonnie's Guitar Strings")).toBe('bonniesguitarstrings');
    expect(normalize('Barbecue & Chili')).toBe('barbecuechili');
    expect(normalize('Dead-Hard_ "X".')).toBe('deadhardx');
  });
});

describe('lookup', () => {
  it('finds renamed perks by old and new name', () => {
    expect(findPerk(cat, 'survivor', 'Decisive Strike')?.slug).toBe('will-to-live');
    expect(findPerk(cat, 'killer', 'Dying Light')).toBeDefined();
    expect(findPerk(cat, 'survivor', 'Babysitter')?.renamedFrom?.slug).toBe('guardian');
  });
  it('perk side handling', () => {
    expect(findPerk(cat, 'killer', 'Adrenaline')).toBeUndefined();
    expect(findPerkAnySide(cat, 'Adrenaline')?.side).toBe('survivor');
  });
  it('killers by name and alias', () => {
    expect(findKiller(cat, 'the trapper')?.slug).toBe('the-trapper');
    expect(findKiller(cat, 'Trapper')?.slug).toBe('the-trapper');
    expect(findKiller(cat, 'Bubba')?.slug).toBe('the-cannibal');
    expect(findKiller(cat, 'nobody')).toBeUndefined();
  });
  it('add-ons, items, variants', () => {
    expect(findPowerAddon(cat, 'the-animatronic', "Bonnie's Guitar Strings")?.slug).toBe('the-animatronic/bonnie-s-guitar-strings');
    expect(findItem(cat, 'Flashlight')?.slug).toBe('flashlight');
    expect(findItemVariant(cat, 'Sport Flashlight')?.slug).toBe('flashlight/sport-flashlight');
    expect(findItemAddon(cat, 'flashlight', 'Battery')?.slug).toBe('flashlight/battery');
  });
  it('offering side fallback', () => {
    const o = cat.offerings.find((x) => x.side === 'survivor')!;
    expect(findOffering(cat, 'survivor', o.name)?.slug).toBe(o.slug);
    expect(findOffering(cat, 'killer', o.name)?.slug).toBe(o.slug);
  });
});

describe('NameIndex ambiguity', () => {
  const a = { n: 'A' }, b = { n: 'B' }, c = { n: 'C' };
  const idx = new NameIndex(
    [
      { record: a, names: ['Alpha'], aliases: ['Shared', 'Beta'] },
      { record: b, names: ['Beta'], aliases: ['Shared'] },
      { record: c, names: ['Gamma'], aliases: ['G'] },
    ],
    (r) => r.n,
  );
  it('alias vs alias is ambiguous', () => {
    expect(() => idx.get('shared')).toThrow(SheetError);
    expect(() => idx.get('shared')).toThrow(/A, B/);
  });
  it('canonical name beats another record alias', () => {
    expect(idx.get('beta')).toBe(b);
  });
  it('normal and missing', () => {
    expect(idx.get('G')).toBe(c);
    expect(idx.get('zzz')).toBeUndefined();
  });
});
