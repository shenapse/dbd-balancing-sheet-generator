import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { findKiller } from '../src/match/lookup.js';
import { measureSheetHeader } from '../src/render/header.js';
import { createImageLoader } from '../src/render/image-loader.js';
import { buildLimitSection } from '../src/render/limit-section.js';
import { fontPt, pt } from '../src/render/theme.js';
import { cat } from './helpers.js';

describe('theme font helpers', () => {
  it('pt converts points to px', () => {
    expect(pt(12)).toBe(16);
    expect(fontPt(12, 'bold')).toBe('16px "Noto Sans Bold"');
  });
});

describe('image loader', () => {
  it('reports each missing file once', async () => {
    const msgs: string[] = [];
    const l = createImageLoader((m) => msgs.push(m));
    expect(await l.load('/nonexistent/a.webp', 'a missing')).toBeNull();
    expect(await l.load('/nonexistent/a.webp', 'a missing again')).toBeNull();
    const map = await l.loadMap(['x', 'x', 'y'], (k) => k, (k) => ({ filePath: `/nonexistent/${k}.webp`, message: `${k} missing` }));
    expect([...map.keys()]).toEqual(['x', 'y']);
    expect(msgs).toEqual(['a missing', 'x missing', 'y missing']);
  });
});

describe('limit section layout', () => {
  const measure = createCanvas(1, 1).getContext('2d');
  it('is null without rules; pill rules are shorter than icon rules', () => {
    expect(buildLimitSection([], 'ALL X', measure)).toBeNull();
    const l = buildLimitSection(
      [
        { scope: 'team', text: 'all', entries: null },
        { scope: 'duo', text: 'some', entries: [{ key: 'k', label: 'Name' }] },
      ],
      'ALL X',
      measure,
    )!;
    expect(l.rules[0]!.contentH).toBeLessThan(l.rules[1]!.contentH);
    expect(l.rules[0]!.pillW).toBeGreaterThan(0);
    expect(l.rules[1]!.slots).toHaveLength(1);
    expect(l.height).toBeGreaterThan(0);
  });
});

describe('sheet header', () => {
  it('keeps the portrait slot when the portrait is missing', () => {
    const killer = findKiller(cat, 'The Trapper')!;
    const measure = createCanvas(1, 1).getContext('2d');
    const spec = { killer, headerH: 190, balancing: 'B', dateLabel: '2000-01-01', lines: [], portrait: null };
    const l = measureSheetHeader(measure, spec);
    expect(l.textX).toBe(32 + (190 - 32) + 16);
    expect(l.metaMaxW).toBeGreaterThan(0);
  });
});
