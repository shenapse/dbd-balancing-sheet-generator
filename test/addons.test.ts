import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/commands/addons.js';
import { SheetError } from '../src/errors.js';
import { findKiller } from '../src/match/lookup.js';
import { Reporter } from '../src/report.js';
import { groupAddonsByRarity } from '../src/render/addon-sheet.js';
import { matchSelector, parseAddonAllowList, rarityToIndex, resolveAddonAllowList } from '../src/rules/addon-allowlist.js';
import { loadYamlFile } from '../src/rules/yaml.js';
import { cat, root } from './helpers.js';

const fx = (n: string) => path.resolve('test/fixtures/addons', n);
const newReporter = () => new Reporter({ tool: 't', version: '0', assetsRef: null, command: 'addons' }, true);
const opts = (files: string[], out: string, iconsOnly: boolean) => ({ files, out, iconsOnly, json: false, strict: false });

describe('addon allow-list resolution', () => {
  it('rarityToIndex accepts names and indices', () => {
    expect(rarityToIndex('Very Rare', 'f')).toBe(3);
    expect(rarityToIndex('ultra-rare', 'f')).toBe(4);
    expect(rarityToIndex(2, 'f')).toBe(2);
    expect(() => rarityToIndex(5, 'f')).toThrow(SheetError);
    expect(() => rarityToIndex('Event', 'f')).toThrow(/Unknown rarity/);
    expect(rarityToIndex('Event', 'f', 6)).toBe(5);
  });

  it('the-trapper example: default allow, deny tier + names, allow wins', () => {
    const doc = parseAddonAllowList(loadYamlFile(fx('the-trapper.yaml')), 'f');
    expect(doc.balancing).toBe('DBDLeague');
    const k = findKiller(cat, doc.killerText)!;
    const res = resolveAddonAllowList(cat, k.slug, doc.section, 'f');
    const universe = cat.addonsByKiller.get(k.slug)!;
    const ultra = universe.filter((a) => a.rarity === 4).length;
    expect(res.length).toBe(universe.length - ultra - 2 + 1); // tier + Honing Stone + Trapper Sack, Bloody Coil re-allowed
    expect(res.map((a) => a.name)).toContain('Bloody Coil');
    expect(res.map((a) => a.name)).not.toContain('Honing Stone');
    expect(res.every((a) => a.killer === k.slug)).toBe(true);
  });

  it('default deny with tier selector; groups sort by rarity then name', () => {
    const k = findKiller(cat, 'The Trapper')!;
    const res = resolveAddonAllowList(cat, k.slug, { default: 'deny', allow: [{ tier: 'Common' }] }, 'f');
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((a) => a.rarity === 0)).toBe(true);
    const sections = groupAddonsByRarity(cat.addonsByKiller.get(k.slug)!);
    expect(sections.map((s) => s.rarity)).toEqual([0, 1, 2, 3, 4]);
    for (const s of sections) {
      const ns = s.addons.map((a) => a.name);
      expect(ns).toEqual([...ns].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('missing default means deny; errors', () => {
    const k = findKiller(cat, 'The Trapper')!;
    expect(resolveAddonAllowList(cat, k.slug, undefined, 'f')).toEqual([]);
    expect(() => resolveAddonAllowList(cat, k.slug, { default: 'maybe' }, 'f')).toThrow(/"default" must be/);
    expect(() => resolveAddonAllowList(cat, k.slug, { allow: ['No Such Addon'] }, 'f')).toThrow(/Unknown add-on name/);
    expect(() => resolveAddonAllowList(cat, k.slug, { allow: [{ foo: 1 }] }, 'f')).toThrow(/Unknown group selector/);
    expect(() => resolveAddonAllowList(cat, k.slug, { allow: [42] }, 'f')).toThrow(/Invalid selector/);
    expect(() => matchSelector(null, [], () => undefined, 'f')).toThrow(SheetError);
  });

  it('top-level default/allow/deny form and tolerance of other tools keys', () => {
    const doc = parseAddonAllowList(
      { killer: 'The Trapper', default: 'allow', deny: [{ rarity: 'Ultra Rare' }], killerPerks: { default: 'allow' } },
      'f',
    );
    expect(doc.section.default).toBe('allow');
    expect(() => parseAddonAllowList({ balancing: 'x' }, 'f')).toThrow(SheetError);
    expect(() => parseAddonAllowList([], 'f')).toThrow(/YAML object/);
  });

  it('combined rules file has an addons section', () => {
    const doc = parseAddonAllowList(loadYamlFile(path.resolve('test/fixtures/rules/the-trapper.yaml')), 'f');
    const k = findKiller(cat, doc.killerText)!;
    expect(resolveAddonAllowList(cat, k.slug, doc.section, 'f').length).toBe(cat.addonsByKiller.get(k.slug)!.length);
  });
});

describe('addons command', () => {
  it('writes sheet and icons, resolves alias-named killers (legacy bug fix)', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-'));
    const reporter = newReporter();
    await run(opts([fx('alias-killer.yaml'), fx('the-trapper.yaml')], out, true), { catalog: cat, assetsRoot: root, reporter });
    const cannibal = findKiller(cat, 'Bubba')!.name.replace(/\s+/g, '-');
    for (const f of [
      `${cannibal}-killer-addons.png`,
      `${cannibal}-killer-addons-icons.png`,
      'The-Trapper-killer-addons.png',
      'The-Trapper-killer-addons-icons.png',
    ]) {
      expect(fs.statSync(path.join(out, f)).size).toBeGreaterThan(1000);
    }
    expect(reporter.files.every((f) => f.outputs.length === 2)).toBe(true);
    expect(reporter.files.flatMap((f) => f.warnings)).toEqual([]);
  });

  it('skips icons for an empty selection and rejects unknown killers', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'addons-'));
    const reporter = newReporter();
    const f = path.join(out, 'empty.yaml');
    fs.writeFileSync(f, 'killer: The Trapper\naddons:\n  default: deny\n');
    await run(opts([f], out, true), { catalog: cat, assetsRoot: root, reporter });
    expect(fs.existsSync(path.join(out, 'The-Trapper-killer-addons.png'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'The-Trapper-killer-addons-icons.png'))).toBe(false);
    fs.writeFileSync(f, 'killer: Nobody Real\n');
    await expect(run(opts([f], out, false), { catalog: cat, assetsRoot: root, reporter })).rejects.toThrow(/Unknown killer/);
  });
});
