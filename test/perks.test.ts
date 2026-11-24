import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SheetError } from '../src/errors.js';
import { findPerk, perkIndex, perkNameIndex } from '../src/match/lookup.js';
import { renderIconSheet, renderSheet } from '../src/render/perk-sheet.js';
import { resolvePerkAllowlist, loadPerkAllowlist } from '../src/rules/perk-allowlist.js';
import {
  classifyLimits,
  comboBansToLimits,
  comboGroupRuleText,
  pickRuleText,
  repetitionLimitsToLimits,
  repetitionRuleText,
  resolveComboBans,
  resolvePickLimits,
  resolveRepetitionLimits,
} from '../src/rules/perk-limits.js';
import { matchSelector, resolveSide } from '../src/rules/perk-selectors.js';
import { findUniversesDir, loadUniverseFile, resolveUniverseDecl } from '../src/rules/universe.js';
import { cat, root } from './helpers.js';

const FX = path.resolve('test/fixtures');
const F = 'test.yaml';
const noop = () => {};
const survivor = (n: string) => findPerk(cat, 'survivor', n)!;
const killer = (n: string) => findPerk(cat, 'killer', n)!;
const collect = () => {
  const w: string[] = [];
  return { w, warn: (m: string) => void w.push(m) };
};
const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SheetError);
    return (e as Error).message;
  }
  throw new Error('expected SheetError');
};

describe('selectors', () => {
  const idx = perkIndex(cat, 'survivor');
  it('matches names, former names and abbreviations', () => {
    expect(matchSelector('Borrowed Time', idx, F)[0]!.name).toBe('Borrowed Time');
    expect(matchSelector('borrowed-time', idx, F)[0]!.slug).toBe(survivor('Borrowed Time').slug);
    const dying = findPerk(cat, 'killer', 'Dying Light')!;
    expect(dying.renamedFrom?.name).toBe('Dying Light');
    expect(dying.name).not.toBe('Dying Light');
    const ds = survivor('Decisive Strike');
    expect(ds.renamedFrom?.name).toBe('Decisive Strike');
    expect(survivor('DS')).toBeDefined();
  });
  it('rebuilds the unquoted-colon Boon quirk', () => {
    const p = matchSelector({ Boon: 'Circle of Healing' }, idx, F)[0]!;
    expect(p.name).toBe('Boon: Circle of Healing');
  });
  it('unknown colon object explains quoting', () => {
    expect(err(() => matchSelector({ Boon: 'Nope' }, idx, F))).toMatch(/wrap it in quotes/);
  });
  it('rejects exhaustion and tag selectors with a clear message', () => {
    expect(err(() => matchSelector({ exhaustion: true }, idx, F))).toMatch(
      /exhaustion selectors are no longer supported; list the perks explicitly/,
    );
    expect(err(() => matchSelector({ tag: 'healing' }, idx, F))).toMatch(/tag selectors are no longer supported/);
  });
  it('rejects unknown names, multi-key objects and invalid values', () => {
    expect(err(() => matchSelector('Not A Perk', idx, F))).toMatch(/Unknown perk name "Not A Perk"/);
    expect(err(() => matchSelector({ a: 1, b: 2 }, idx, F))).toMatch(/Unknown group selector/);
    expect(err(() => matchSelector(42, idx, F))).toMatch(/Invalid selector value 42/);
  });
  it('reports perks outside a narrowed universe', () => {
    const uni = perkNameIndex([survivor('Borrowed Time')]);
    expect(err(() => matchSelector('Sprint Burst', uni, F, idx))).toMatch(/not in this build's perk universe/);
    expect(err(() => matchSelector('Bogus', uni, F, idx))).toMatch(/Unknown perk name/);
  });
});

describe('resolveSide', () => {
  it('default allow minus deny', () => {
    const all = resolveSide(cat, 'survivor', undefined, 'all', F);
    expect(all.length).toBe(cat.perksBySide.survivor.length);
    const r = resolveSide(cat, 'survivor', { deny: ['Sprint Burst'] }, 'all', F);
    expect(r.length).toBe(all.length - 1);
    expect(r.find((p) => p.name === 'Sprint Burst')).toBeUndefined();
  });
  it('default deny plus allow, sorted by name; allow wins over deny', () => {
    const r = resolveSide(cat, 'survivor', { default: 'deny', allow: ['Unbreakable', 'Adrenaline'], deny: ['Adrenaline'] }, 'all', F);
    expect(r.map((p) => p.name)).toEqual(['Adrenaline', 'Unbreakable']);
  });
  it('restricts to an inline universe', () => {
    const r = resolveSide(cat, 'survivor', { deny: ['Adrenaline'] }, ['Adrenaline', 'Unbreakable', 'Bond'], F);
    expect(r.map((p) => p.name)).toEqual(['Bond', 'Unbreakable']);
    expect(err(() => resolveSide(cat, 'survivor', { allow: ['Sprint Burst'] }, ['Bond'], F))).toMatch(/not in this build's perk universe/);
    expect(err(() => resolveSide(cat, 'survivor', undefined, ['Zzz'], F))).toMatch(/Unknown perk "Zzz" in universe list/);
  });
  it('rejects a bad default', () => {
    expect(err(() => resolveSide(cat, 'survivor', { default: 'maybe' as never }, 'all', F))).toMatch(/"default" must be/);
  });
});

describe('universes', () => {
  const uni = path.join(FX, 'universes');
  it('finds the universes dir by walking up, or uses the explicit one', () => {
    expect(findUniversesDir(null, path.join(FX, 'perks', 'the-trapper.yaml'))).toBe(uni);
    expect(findUniversesDir('/x/y', 'a.yaml')).toBe('/x/y');
    expect(findUniversesDir(null, path.join(os.tmpdir(), 'nonexistent-dir', 'a.yaml'))).toBeNull();
  });
  it('loads a universe file (cached) with canonical names', () => {
    const u = loadUniverseFile(cat, path.join(uni, 'quartet-standard.yaml'));
    expect(Array.isArray(u.killer)).toBe(true);
    expect(loadUniverseFile(cat, path.join(uni, 'quartet-standard.yaml'))).toBe(u);
    for (const n of u.killer as string[]) expect(findPerk(cat, 'killer', n)?.name).toBe(n);
  });
  it('expands declarations', () => {
    const y = path.join(FX, 'perks', 'x.yaml');
    expect(resolveUniverseDecl(cat, undefined, 'killer', y)).toBe('all');
    expect(resolveUniverseDecl(cat, { killer: ['A', 'B'] }, 'killer', y)).toEqual(['A', 'B']);
    expect(resolveUniverseDecl(cat, { killer: 'all' }, 'survivor', y)).toBe('all');
    const fromId = resolveUniverseDecl(cat, 'quartet-standard', 'survivor', y);
    expect(Array.isArray(fromId)).toBe(true);
    expect(err(() => resolveUniverseDecl(cat, 'nope', 'killer', y))).toMatch(/Unknown universe "nope".*quartet-standard/);
    expect(err(() => resolveUniverseDecl(cat, { foo: 1 }, 'killer', y))).toMatch(/Unknown key "foo"/);
    expect(err(() => resolveUniverseDecl(cat, 5, 'killer', y))).toMatch(/Invalid universe declaration/);
    expect(err(() => resolveUniverseDecl(cat, 'quartet-standard', 'killer', y, '/nonexistent-dir-xyz'))).toMatch(/Cannot read universes directory/);
  });
  it('validates universe files (unknown key, unknown perk, duplicates, bad entries)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-'));
    const w = (name: string, body: string) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, body);
      return f;
    };
    expect(err(() => loadUniverseFile(cat, w('a.yaml', 'bogus: 1\n')))).toMatch(/Unknown key "bogus"/);
    expect(err(() => loadUniverseFile(cat, w('b.yaml', 'killer: [Nope Perk]\n')))).toMatch(/Unknown killer perk "Nope Perk"/);
    expect(err(() => loadUniverseFile(cat, w('c.yaml', 'survivor: [Bond, bond]\n')))).toMatch(/Duplicate survivor perk/);
    expect(err(() => loadUniverseFile(cat, w('d.yaml', 'survivor: [Boon: Circle of Healing]\n')))).toMatch(/wrap it in quotes/);
    expect(err(() => loadUniverseFile(cat, w('e.yaml', 'survivor: []\n')))).toMatch(/non-empty list/);
    expect(err(() => loadUniverseFile(cat, w('f.yaml', '- a\n')))).toMatch(/does not contain a YAML object/);
    expect(err(() => loadUniverseFile(cat, path.join(dir, 'missing.yaml')))).toMatch(/Cannot read universe file/);
  });
  it('a named universe narrows the allow-list', () => {
    const doc = { killer: 'The Trapper', universe: 'quartet-standard', survivorPerks: { default: 'allow' } };
    const al = resolvePerkAllowlist(cat, doc, path.join(FX, 'perks', 'x.yaml'), { warn: noop });
    const u = loadUniverseFile(cat, path.join(FX, 'universes', 'quartet-standard.yaml'));
    expect(al.allowedSurvivor.length).toBe((u.survivor as string[]).length);
  });
});

describe('combo bans', () => {
  const allowed = ['Prove Thyself', 'Botany Knowledge', 'Bond', 'Kindred'].map(survivor);
  it('orders survivor scopes by strictness regardless of YAML order', () => {
    const r = resolveComboBans(
      cat,
      { team: [['Bond', 'Kindred']], survivor: [['Prove Thyself', 'Botany Knowledge']] },
      'survivor',
      allowed,
      F,
      noop,
    );
    expect(r.map((c) => c.scope)).toEqual(['survivor', 'team']);
    expect(r[0]!.perks.map((p) => p.name)).toEqual(['Prove Thyself', 'Botany Knowledge']);
  });
  it('killer combos use the build scope and Boon quirk works in combos', () => {
    const boon = resolveComboBans(cat, { duo: [[{ Boon: 'Circle of Healing' }, 'Bond']] }, 'survivor', [], F, noop);
    expect(boon[0]!.perks[0]!.name).toBe('Boon: Circle of Healing');
    const k = resolveComboBans(cat, [['Pop Goes the Weasel', 'Overcharge']], 'killer', [], F, noop);
    expect(k[0]!.scope).toBe('build');
  });
  it('warns about moot combos and errors on bad input', () => {
    const { w, warn } = collect();
    resolveComboBans(cat, { duo: [['Bond', 'Kindred']] }, 'survivor', [survivor('Bond')], F, warn);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/combo-ban perk "Kindred".*moot/);
    expect(err(() => resolveComboBans(cat, { world: [] }, 'survivor', allowed, F, noop))).toMatch(/Unknown survivor combo-ban scope/);
    expect(err(() => resolveComboBans(cat, { duo: [['Bond']] }, 'survivor', allowed, F, noop))).toMatch(/at least 2 perks/);
    expect(err(() => resolveComboBans(cat, { duo: [['Bond', { exhaustion: true }]] }, 'survivor', allowed, F, noop))).toMatch(/exhaustion/);
    expect(err(() => resolveComboBans(cat, [], 'survivor', allowed, F, noop))).toMatch(/must be a map/);
    expect(err(() => resolveComboBans(cat, {}, 'killer', allowed, F, noop))).toMatch(/must be a list/);
    expect(resolveComboBans(cat, null, 'killer', [], F, noop)).toEqual([]);
  });
});

describe('repetition limits', () => {
  const allowed = ['Self-Care', 'Botany Knowledge'].map(survivor);
  it('resolves, defaults perks to all and sorts duo before team', () => {
    const r = resolveRepetitionLimits(
      cat,
      [
        { scope: 'team', max: 2, perks: ['Self-Care', 'Botany Knowledge'] },
        { scope: 'duo', max: 1, perks: 'all' },
        { scope: 'team', max: 1 },
      ],
      allowed,
      F,
      noop,
    );
    expect(r.map((x) => [x.scope, x.max, x.perks?.length ?? null])).toEqual([
      ['duo', 1, null],
      ['team', 2, 2],
      ['team', 1, null],
    ]);
  });
  it('warns on vacuous duo max and errors on bad scope/max', () => {
    const { w, warn } = collect();
    resolveRepetitionLimits(cat, [{ scope: 'duo', max: 2 }], allowed, F, warn);
    expect(w[0]).toMatch(/vacuous/);
    expect(err(() => resolveRepetitionLimits(cat, [{ scope: 'survivor', max: 1 }], allowed, F, noop))).toMatch(/meaningless/);
    expect(err(() => resolveRepetitionLimits(cat, [{ scope: 'team', max: 0 }], allowed, F, noop))).toMatch(/positive integer/);
    expect(err(() => resolveRepetitionLimits(cat, {}, allowed, F, noop))).toMatch(/must be a list/);
  });
});

describe('pick limits and classification', () => {
  const four = ['Sprint Burst', 'Bond', 'Kindred', 'Unbreakable'];
  it('resolves survivor and killer pick limits', () => {
    const s = resolvePickLimits(cat, [{ scope: 'duo', max: 1, perks: four }], 'survivor', [], F, noop);
    expect(s[0]).toMatchObject({ scope: 'duo', count: 'total', max: 1 });
    const k = resolvePickLimits(cat, [{ max: 2, perks: ['Pop Goes the Weasel', 'Overcharge', 'Eruption'] }], 'killer', [], F, noop);
    expect(k[0]!.scope).toBe('build');
  });
  it('errors', () => {
    expect(err(() => resolvePickLimits(cat, [{ max: 1, perks: four }], 'survivor', [], F, noop))).toMatch(/Invalid pick-limit scope/);
    expect(err(() => resolvePickLimits(cat, [{ scope: 'team', max: 1, perks: ['Bond'] }], 'survivor', [], F, noop))).toMatch(/at least 2 perks/);
    expect(err(() => resolvePickLimits(cat, [{ scope: 'duo', max: 1 }], 'survivor', [], F, noop))).toMatch(/must be a list of perk names/);
    expect(err(() => resolvePickLimits(cat, [{ scope: 'duo', max: 1, perks: four }], 'killer', [], F, noop))).toMatch(/take no scope/);
  });
  it('classifies into duplicate / pick / combo, dropping vacuous ones', () => {
    const { w, warn } = collect();
    const pk = (names: string[]) => names.map(survivor);
    const limits = [
      ...comboBansToLimits([{ scope: 'team', perks: pk(['Bond', 'Kindred']) }]),
      ...repetitionLimitsToLimits([{ scope: 'duo', max: 1, perks: null }]),
      { scope: 'duo' as const, count: 'total' as const, max: 1, perks: pk(four) }, // pick (1 < 3)
      { scope: 'survivor' as const, count: 'total' as const, max: 3, perks: pk(four.slice(0, 4)) }, // max = len-1 -> combo
      { scope: 'team' as const, count: 'total' as const, max: 4, perks: pk(four) }, // vacuous
      { scope: 'team' as const, count: 'total' as const, max: 1, perks: null }, // unsupported
    ];
    const b = classifyLimits(limits, F, warn);
    expect(b.duplicate).toHaveLength(1);
    expect(b.pick).toHaveLength(1);
    expect(b.combo.map((c) => c.scope)).toEqual(['survivor', 'team']);
    expect(w).toHaveLength(2);
  });
  it('rule text', () => {
    const pair = { perks: [survivor('Bond'), survivor('Kindred')] };
    expect(comboGroupRuleText('survivor', [pair])).toBe('One survivor may not bring both perks.');
    expect(comboGroupRuleText('build', [{ perks: [...pair.perks, survivor('Unbreakable')] }])).toBe(
      'The killer may not bring all of these in one build.',
    );
    expect(pickRuleText({ scope: 'duo', max: 1 })).toBe('Each duo may bring at most one of these perks between its two members.');
    expect(pickRuleText({ scope: 'team', max: 2 })).toBe('The team may bring at most 2 of these perks.');
    expect(repetitionRuleText({ scope: 'duo', max: 1, perks: null })).toBe('Duo partners may not both bring the same perk.');
    expect(repetitionRuleText({ scope: 'team', max: 2, perks: [] })).toBe('At most 2 survivors may bring any single listed perk.');
  });
});

describe('allow-list documents', () => {
  const y = path.join(FX, 'perks', 'the-trapper.yaml');
  it('resolves the Trapper fixture (unknown top-level keys tolerated)', () => {
    const { w, warn } = collect();
    const al = loadPerkAllowlist(cat, y, { warn });
    expect(al.killer.name).toBe('The Trapper');
    expect(al.balancing).toBe('DBDLeague');
    expect(al.allowedSurvivor.length).toBe(16);
    expect(al.survivorBuckets.duplicate).toHaveLength(2);
    expect(al.survivorBuckets.pick).toHaveLength(1);
    expect(al.survivorBuckets.combo).toHaveLength(3);
    expect(al.killerBuckets.combo).toHaveLength(1);
    expect(al.killerBuckets.pick).toHaveLength(1);
    expect(w).toEqual([]);
    const withExtra = resolvePerkAllowlist(cat, { killer: 'Trapper', addons: { default: 'allow' }, display: { x: 1 } }, y, { warn: noop });
    expect(withExtra.killer.name).toBe('The Trapper');
  });
  it('a file with an exhaustion selector fails clearly', () => {
    expect(err(() => loadPerkAllowlist(cat, path.join(FX, 'perks', 'exhaustion-unsupported.yaml'), { warn: noop }))).toMatch(
      /exhaustion selectors are no longer supported/,
    );
  });
  it('reports missing/unknown killer and non-object documents', () => {
    expect(err(() => resolvePerkAllowlist(cat, {}, y, { warn: noop }))).toMatch(/killer/);
    expect(err(() => resolvePerkAllowlist(cat, { killer: 'Nobody' }, y, { warn: noop }))).toMatch(/Unknown killer "Nobody"/);
    expect(err(() => resolvePerkAllowlist(cat, null, y, { warn: noop }))).toMatch(/does not contain a YAML object/);
    expect(err(() => resolvePerkAllowlist(cat, { killer: 'The Trapper', killerPerks: { default: 'maybe' } }, y, { warn: noop }))).toMatch(/default/);
  });
  it('killer slug filenames and rendering smoke (placeholder warning for missing icons not triggered)', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'perks-'));
    const al = loadPerkAllowlist(cat, y, { warn: noop });
    const { w, warn } = collect();
    const env = { assetsRoot: root, warn };
    const f = await renderSheet(env, {
      killer: al.killer, perks: al.allowedSurvivor, side: 'survivor', columns: 8, outDir: out,
      killerSlug: 'The-Trapper', balancing: al.balancing, dateLabel: '2026-01-01', limits: al.survivorBuckets,
    });
    expect(path.basename(f)).toBe('The-Trapper-survivor-perks.png');
    const icons = await renderIconSheet(env, { perks: al.allowedSurvivor, side: 'survivor', columns: 8, outDir: out, killerSlug: 'The-Trapper' });
    expect(path.basename(icons!)).toBe('The-Trapper-survivor-perks-icons.png');
    expect(await renderIconSheet(env, { perks: [], side: 'killer', columns: 8, outDir: out, killerSlug: 'x' })).toBeNull();
    expect(fs.statSync(f).size).toBeGreaterThan(5000);
    expect(w).toEqual([]);
    expect(killer('Pop Goes the Weasel')).toBeDefined();
  });
});
