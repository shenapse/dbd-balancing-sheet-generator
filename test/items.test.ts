import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/commands/items.js';
import { SheetError } from '../src/errors.js';
import { Reporter } from '../src/report.js';
import { buildItemGroups, computeBodyLayout, computeIconBodyLayout } from '../src/render/item-sheet.js';
import { parseItemAllowList, resolveItemAllowList } from '../src/rules/item-allowlist.js';
import { itemDuplicateRuleText, itemPickRuleText, parseItemLimits } from '../src/rules/item-limits.js';
import { loadYamlFile } from '../src/rules/yaml.js';
import { cat, root } from './helpers.js';

const trapper = path.resolve('test/fixtures/items/the-trapper.yaml');
const rules = path.resolve('test/fixtures/rules/the-trapper.yaml');
const newReporter = () => new Reporter({ tool: 't', version: '0', assetsRef: null, command: 'items' }, true);

function load(file: string) {
  const doc = parseItemAllowList(loadYamlFile(file), file);
  const types = resolveItemAllowList(cat, doc.items, doc.topDefault, file);
  return { doc, types };
}
type Types = ReturnType<typeof load>['types'];
const sel = (types: Types, slug: string) => types.find((t) => t.item.slug === slug)!;

describe('item allow-list resolution', () => {
  it('the-trapper example', () => {
    const { doc, types } = load(trapper);
    expect(doc.balancing).toBe('DBDLeague');
    expect(types.map((t) => t.item.slug)).toEqual(['firecracker', 'flashlight', 'med-kit', 'toolbox', 'key', 'map', 'fog-vial']);
    const fl = sel(types, 'flashlight');
    expect(fl.variants.map((v) => v.name)).toEqual(['Sport Flashlight']);
    expect(fl.addons.map((a) => a.name)).toEqual(['Battery', 'Leather Grip', 'Power Bulb', 'Wide Lens']);
    const mk = sel(types, 'med-kit');
    expect(mk.variants.map((v) => v.name)).not.toContain('Anniversary Med-Kit');
    expect(mk.addons.map((a) => a.name)).not.toContain('Styptic Agent');
    expect(sel(types, 'toolbox').addons).toEqual([]);
    expect(sel(types, 'key').variants).toEqual([]);
    expect(buildItemGroups(types).map((g) => g.typeName)).toEqual(['Flashlight', 'Med-Kit', 'Toolbox']);
  });

  it('combined rules file tolerates other sections and unknown per-type keys', () => {
    const { types } = load(rules);
    expect(sel(types, 'flashlight').variants.map((v) => v.name)).toEqual(['Sport Flashlight']);
    expect(sel(types, 'flashlight').addons.every((a) => a.rarity === 0)).toBe(true);
    expect(sel(types, 'fog-vial').variants).toEqual([]);
  });

  it('addon default falls back to the type default', () => {
    const types = resolveItemAllowList(cat, { Toolbox: { default: 'allow' } }, 'deny', 'f');
    expect(sel(types, 'toolbox').variants.length).toBe(cat.itemsBySlug.get('toolbox')!.variants.length);
    expect(sel(types, 'toolbox').addons.length).toBe(cat.itemAddonsByItem.get('toolbox')!.length);
  });

  it('errors', () => {
    expect(() => resolveItemAllowList(cat, { Banana: {} }, 'deny', 'f')).toThrow(/Unknown item type "Banana"/);
    expect(() => resolveItemAllowList(cat, { Flashlight: { allow: ['Nope'] } }, 'deny', 'f')).toThrow(/Unknown Flashlight variant/);
    expect(() => resolveItemAllowList(cat, { Flashlight: { addons: { allow: ['Nope'] } } }, 'deny', 'f')).toThrow(/Unknown Flashlight add-on/);
    expect(() => resolveItemAllowList(cat, { Flashlight: { allow: [{ tag: 1 }] } }, 'deny', 'f')).toThrow(/Invalid Flashlight variant selector/);
    expect(() => resolveItemAllowList(cat, { Flashlight: { default: 'x' } }, 'deny', 'f')).toThrow(/"default" must be/);
    expect(() => parseItemAllowList({ killer: 'x', default: 'x' }, 'f')).toThrow(/Top-level "default"/);
    expect(() => parseItemAllowList({ killer: 'x', items: { Flashlight: 5 } }, 'f')).toThrow(SheetError);
  });

  it('rarity selector on variants', () => {
    const types = resolveItemAllowList(cat, { Flashlight: { default: 'deny', allow: [{ rarity: 'Event' }] } }, 'deny', 'f');
    expect(sel(types, 'flashlight').variants.every((v) => v.rarity === 5)).toBe(true);
  });
});

describe('item limits', () => {
  it('parses the example (duplicate-all + pick over types)', () => {
    const { doc, types } = load(trapper);
    const warnings: string[] = [];
    const lim = parseItemLimits(cat, doc.raw, types, 'f', (m) => warnings.push(m));
    expect(lim.duplicate).toHaveLength(1);
    expect(lim.duplicate[0]!.items).toBeNull();
    expect(lim.pick).toHaveLength(1);
    expect(lim.pick[0]!.items!.length).toBe(sel(types, 'med-kit').variants.length + sel(types, 'toolbox').variants.length);
    expect(warnings).toEqual([]);
  });

  it('wording', () => {
    expect(itemDuplicateRuleText({ scope: 'team', max: 1, items: null })).toBe('No two survivors may bring the same item.');
    expect(itemDuplicateRuleText({ scope: 'duo', max: 2, items: [] })).toBe('At most 2 duo members may bring any single listed item.');
    expect(itemPickRuleText({ scope: 'team', max: 2 })).toBe('The team may bring at most 2 of these items.');
    expect(itemPickRuleText({ scope: 'duo', max: 1 })).toBe('Each duo may bring at most one of these items between its two members.');
  });

  it('warnings and errors', () => {
    const { types } = load(trapper);
    const w: string[] = [];
    // a banned variant is dropped with a warning; the pick limit then has <2 items and is skipped
    const lim = parseItemLimits(
      cat,
      { itemPickLimits: [{ scope: 'team', max: 1, items: ['Sport Flashlight', 'Anniversary Med-Kit'] }] },
      types,
      'f',
      (m) => w.push(m),
    );
    expect(lim.pick).toEqual([]);
    expect(w.length).toBe(2);
    const p = (raw: object) => () => parseItemLimits(cat, raw, types, 'f');
    expect(p({ itemDuplicateLimits: [{ scope: 'survivor', max: 1 }] })).toThrow(/duo.*team/);
    expect(p({ itemDuplicateLimits: [{ scope: 'team', max: 0 }] })).toThrow(/positive integer/);
    expect(p({ itemPickLimits: [{ scope: 'team', max: 1, items: ['Toolbox'] }] })).toThrow(/at least 2/);
    expect(p({ itemPickLimits: [{ scope: 'team', max: 1, items: ['Nope', 'x'] }] })).toThrow(/Unknown item "Nope"/);
    expect(p({ itemPickLimits: [{ scope: 'team', max: 1, items: [{ type: 'Nope' }, 'x'] }] })).toThrow(/Unknown item type/);
    expect(p({ itemDuplicateLimits: 'x' })).toThrow(/must be a list/);
  });
});

describe('item layout and command', () => {
  it('icons-only layout widens group gap and drops headers', () => {
    const groups = buildItemGroups(load(trapper).types);
    const full = computeBodyLayout(groups);
    const icons = computeIconBodyLayout(groups);
    expect(full.elements.filter((e) => e.kind === 'header')).toHaveLength(groups.length);
    expect(icons.elements.every((e) => e.kind === 'row')).toBe(true);
    expect(icons.bodyH).toBeLessThan(full.bodyH);
  });

  it('writes sheet and icons for each file', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'items-'));
    const reporter = newReporter();
    await run({ files: [trapper, rules], out, iconsOnly: true, json: false, strict: false }, { catalog: cat, assetsRoot: root, reporter });
    expect(reporter.files[0]!.outputs.map((p) => path.basename(p))).toEqual(['The-Trapper-items.png', 'The-Trapper-items-icons.png']);
    for (const p of reporter.files.flatMap((f) => f.outputs)) expect(fs.statSync(p).size).toBeGreaterThan(500);
    expect(reporter.files.flatMap((f) => f.warnings)).toEqual([]);
  });

  it('empty selection: sheet only', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'items-'));
    const reporter = newReporter();
    const f = path.join(out, 'e.yaml');
    fs.writeFileSync(f, 'killer: The Trapper\n');
    await run({ files: [f], out, iconsOnly: true, json: false, strict: false }, { catalog: cat, assetsRoot: root, reporter });
    expect(fs.existsSync(path.join(out, 'The-Trapper-items.png'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'The-Trapper-items-icons.png'))).toBe(false);
  });
});
