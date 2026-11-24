import { describe, expect, it } from 'vitest';
import { SheetError } from '../src/errors.js';
import { applyAllowDeny } from '../src/rules/allow-deny.js';
import { duplicateRuleText, pickRuleText, scopeRank, sortByScope } from '../src/rules/limit-text.js';
import { itemDuplicateRuleText, itemPickRuleText } from '../src/rules/item-limits.js';
import { pickRuleText as perkPickRuleText, repetitionRuleText } from '../src/rules/perk-limits.js';
import { ITEM_RARITY_COUNT, POWER_ADDON_RARITY_COUNT, selectByRarity } from '../src/rules/rarity.js';

const U = ['a', 'b', 'c', 'd'].map((n) => ({ slug: n, rarity: n.charCodeAt(0) % 2 }));
const bySlug = (sel: unknown) => {
  const e = U.find((u) => u.slug === sel);
  if (!e) throw new SheetError(`unknown ${String(sel)}`);
  return [e];
};
const opts = (fallbackDefault: 'allow' | 'deny') => ({ fallbackDefault, invalidDefaultMessage: 'bad default' });
const slugs = (r: { slug: string }[]) => r.map((e) => e.slug);

describe('applyAllowDeny', () => {
  it('default allow minus deny', () => {
    expect(slugs(applyAllowDeny(U, { default: 'allow', deny: ['b'] }, bySlug, opts('deny')))).toEqual(['a', 'c', 'd']);
  });
  it('default deny plus allow', () => {
    expect(slugs(applyAllowDeny(U, { default: 'deny', allow: ['c', 'a'] }, bySlug, opts('allow')))).toEqual(['c', 'a']);
  });
  it('allow wins over deny', () => {
    expect(slugs(applyAllowDeny(U, { default: 'allow', deny: ['a', 'b'], allow: ['a'] }, bySlug, opts('deny')))).toEqual([
      'c',
      'd',
      'a',
    ]);
  });
  it('uses the fallback default when missing or null', () => {
    expect(applyAllowDeny(U, undefined, bySlug, opts('deny'))).toEqual([]);
    expect(applyAllowDeny(U, { default: null }, bySlug, opts('allow'))).toHaveLength(4);
  });
  it('one selector may expand to several records', () => {
    const byRarity = (sel: unknown) => selectByRarity(U, sel, 'f', 2);
    expect(slugs(applyAllowDeny(U, { default: 'deny', allow: [1] }, byRarity, opts('deny')))).toEqual(['a', 'c']);
  });
  it('rejects a bad default with the supplied message and propagates selector errors', () => {
    expect(() => applyAllowDeny(U, { default: 'maybe' }, bySlug, opts('deny'))).toThrow('bad default');
    expect(() => applyAllowDeny(U, { allow: ['zzz'] }, bySlug, opts('deny'))).toThrow(/unknown zzz/);
  });
});

describe('rarity helpers', () => {
  it('knows the rarity counts', () => {
    expect(POWER_ADDON_RARITY_COUNT).toBe(5);
    expect(ITEM_RARITY_COUNT).toBe(6);
  });
});

describe('shared limit text', () => {
  it('pick text is noun-parameterised', () => {
    expect(pickRuleText({ scope: 'team', max: 1 }, 'perk')).toBe('The team may bring at most one of these perks.');
    expect(pickRuleText({ scope: 'duo', max: 2 }, 'item')).toBe('Each duo may bring at most 2 of these items between its two members.');
    expect(pickRuleText({ scope: 'survivor', max: 2 }, 'perk')).toBe('One survivor may bring at most 2 of these perks.');
    expect(pickRuleText({ scope: 'build', max: 1 }, 'perk')).toBe('The killer may bring at most one of these perks in one build.');
    expect(pickRuleText({ scope: '?', max: 3 }, 'item')).toBe('At most 3 of these items may be brought.');
  });
  it('duplicate text covers duo/team, max 1/N and listed', () => {
    expect(duplicateRuleText({ scope: 'duo', max: 1 }, false, 'perk')).toBe('Duo partners may not both bring the same perk.');
    expect(duplicateRuleText({ scope: 'duo', max: 2 }, true, 'item')).toBe('At most 2 duo members may bring any single listed item.');
    expect(duplicateRuleText({ scope: 'team', max: 1 }, true, 'item')).toBe('No two survivors may bring the same listed item.');
    expect(duplicateRuleText({ scope: 'team', max: 3 }, false, 'perk')).toBe('At most 3 survivors may bring any single perk.');
  });
  it('perk and item wrappers keep their strings', () => {
    expect(perkPickRuleText({ scope: 'team', max: 2 })).toBe('The team may bring at most 2 of these perks.');
    expect(itemPickRuleText({ scope: 'team', max: 2 })).toBe('The team may bring at most 2 of these items.');
    expect(repetitionRuleText({ scope: 'duo', max: 1, perks: [] })).toBe('Duo partners may not both bring the same listed perk.');
    expect(repetitionRuleText({ scope: 'duo', max: 1, perks: null })).toBe('Duo partners may not both bring the same perk.');
    expect(itemDuplicateRuleText({ scope: 'team', max: 1, items: null })).toBe('No two survivors may bring the same item.');
  });
  it('sorts by scope, stable, unknown last', () => {
    expect(scopeRank('duo')).toBeLessThan(scopeRank('team'));
    expect(scopeRank('nope')).toBe(4);
    const l = [{ scope: 'team', i: 0 }, { scope: 'duo', i: 1 }, { scope: 'team', i: 2 }, { scope: 'survivor', i: 3 }];
    expect(sortByScope(l).map((x) => x.i)).toEqual([3, 1, 0, 2]);
  });
});
