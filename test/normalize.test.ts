import { describe, expect, it } from 'vitest';
import { findPerk } from '../src/match/lookup.js';
import { normalize } from '../src/match/normalize.js';
import { cat } from './helpers.js';

describe('normalize curly quotes', () => {
  it('strips typographic quotes', () => {
    expect(normalize('Dead Man’s Switch')).toBe(normalize("Dead Man's Switch"));
    expect(normalize('‘a’ “b”')).toBe('ab');
  });
  it('resolves a perk typed with a curly apostrophe', () => {
    expect(findPerk(cat, 'killer', 'Dead Man’s Switch')).toBeTruthy();
  });
});
