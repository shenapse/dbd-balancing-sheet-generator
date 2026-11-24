import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from '../src/commands/builds.js';
import { SheetError } from '../src/errors.js';
import { Reporter } from '../src/report.js';
import { renderIconSheet, renderSheet, rowSlots } from '../src/render/build-sheet.js';
import { outputFilename, parseBuildFile, loadBuildFile } from '../src/rules/build-file.js';
import { loadRulesContext, validateModel, VIOLATION_KIND_ORDER, joinWithAnd } from '../src/rules/build-rules.js';
import { cat, root } from './helpers.js';

const killerFile = path.resolve('test/fixtures/builds/the-trapper-killer.yaml');
const survivorFile = path.resolve('test/fixtures/builds/the-trapper-survivors.yaml');
const rulesFile = path.resolve('test/fixtures/rules/the-trapper.yaml');
const noWarn = () => {};
const rules = () => loadRulesContext(cat, rulesFile, undefined, noWarn);
const parse = (doc: unknown) => parseBuildFile(cat, doc, '/x.yaml');
const newReporter = () => new Reporter({ tool: 't', version: '0', assetsRef: null, command: 'builds' }, true);

describe('build file parsing', () => {
  it('parses the killer fixture', () => {
    const m = loadBuildFile(cat, killerFile);
    expect(m.isSurvivorSheet).toBe(false);
    expect(m.killer?.name).toBe('The Trapper');
    expect(m.balancing).toBe('DBDLeague');
    expect(m.rows).toHaveLength(3);
    expect(m.rows[1]!.perks.map((p) => p?.name ?? null)).toEqual([
      'Scourge Hook: Pain Resonance',
      'Pop Goes the Weasel',
      'Sloppy Butcher',
      null,
    ]);
    expect(m.rows[2]!.offering).toBeNull();
    expect(m.rows[2]!.addons.map((a) => a?.name ?? null)).toEqual(['Tar Bottle', null]);
  });

  it('parses the survivor fixture', () => {
    const m = loadBuildFile(cat, survivorFile);
    expect(m.isSurvivorSheet).toBe(true);
    expect(m.rows[0]!.item?.name).toBe('Sport Flashlight');
    expect(m.rows[0]!.addons.map((a) => a?.name)).toEqual(['Wide Lens', 'Power Bulb']);
    expect(m.rows[2]!.item).toBeNull();
  });

  it('rejects a survivor perk in a killer build and vice versa, distinct from unknown', () => {
    expect(() => parse({ killer: 'The Trapper', builds: [{ perks: ['Sprint Burst'] }] })).toThrow(
      /is a survivor perk and cannot be used in a killer build/,
    );
    expect(() => parse({ survivors: [{ perks: ['Bamboozle'] }] })).toThrow(
      /is a killer perk and cannot be used in a survivor build/,
    );
    expect(() => parse({ survivors: [{ perks: ['No Such Perk'] }] })).toThrow(/Unknown perk name "No Such Perk"/);
  });

  it('rejects non-string perk entries instead of rebuilding them', () => {
    expect(() => parse({ survivors: [{ perks: [{ Boon: 'Circle of Healing' }] }] })).toThrow(/must be a quoted string/);
  });

  it('enforces structure: both/neither side, limits, duplicates, add-on rules', () => {
    expect(() => parse({ killer: 'The Trapper', builds: [{}], survivors: [{}] })).toThrow(/got both/);
    expect(() => parse({ killer: 'The Trapper' })).toThrow(/got neither/);
    expect(() => parse({ builds: [{}] })).toThrow(/Missing "killer"/);
    expect(() => parse({ killer: 'The Trapper', builds: [] })).toThrow(/non-empty list/);
    expect(() => parse({ survivors: Array(5).fill({}) })).toThrow(/at most 4 are allowed/);
    expect(() => parse({ survivors: [{ perks: ['Bond', 'Kindred', 'Adrenaline', 'Self-Care', 'Resilience'] }] })).toThrow(
      /5 perks; at most 4/,
    );
    expect(() => parse({ survivors: [{ perks: ['Bond', 'bond'] }] })).toThrow(/Duplicate perk "Bond"/);
    expect(() => parse({ survivors: [{ addons: ['Wide Lens'] }] })).toThrow(/has "addons" but no "item"/);
    expect(() => parse({ survivors: [{ item: 'Sport Flashlight', addons: ['A', 'B', 'C'] }] })).toThrow(/at most 2/);
    expect(() => parse({ survivors: [{ item: 'Sport Flashlight', addons: ['Wide Lens', 'Wide Lens'] }] })).toThrow(
      /Duplicate add-on "Wide Lens"/,
    );
    expect(() => parse({ survivors: [{ item: 'Sport Flashlight', addons: ['Rubber Gloves'] }] })).toThrow(
      /not part of item "Sport Flashlight"'s add-on pool/,
    );
    expect(() => parse({ killer: 'The Trapper', builds: [{ item: 'Sport Flashlight' }] })).toThrow(/survivor-only/);
    expect(() => parse({ survivors: [{ item: 'Nope' }] })).toThrow(/Unknown item "Nope"/);
    expect(() => parse({ survivors: [{ offering: 'Nope' }] })).toThrow(/Unknown offering "Nope"/);
    expect(() => parse({ killer: 'The Trapper', builds: [{ addons: ['Wide Lens'] }] })).toThrow(
      /not part of killer "The Trapper"'s add-on pool/,
    );
    expect(() => parse({ killer: 'Nobody', builds: [{}] })).toThrow(SheetError);
  });

  it('offering lookup falls back to the other side', () => {
    const o = cat.offerings.find((x) => x.side === 'killer')!;
    const m = parse({ survivors: [{ offering: o.name }] });
    expect(m.rows[0]!.offering?.slug).toBe(o.slug);
    const s = cat.offerings.find((x) => x.side === 'survivor')!;
    expect(parse({ killer: 'The Trapper', builds: [{ offering: s.name }] }).rows[0]!.offering?.slug).toBe(s.slug);
  });

  it('derives output filenames', () => {
    const k = loadBuildFile(cat, killerFile);
    expect(outputFilename(k, false)).toBe('The-Trapper-killer-builds.png');
    expect(outputFilename(k, true)).toBe('The-Trapper-killer-builds-icons.png');
    const s = loadBuildFile(cat, survivorFile);
    expect(outputFilename(s, false)).toBe('The-Trapper-survivor-builds.png');
    const noKiller = parseBuildFile(cat, { survivors: [{}] }, '/tmp/my-match.yaml');
    expect(outputFilename(noKiller, true)).toBe('my-match-survivor-builds-icons.png');
  });
});

describe('build rules', () => {
  it('flags the killer fixture violations in order and text', () => {
    const v = validateModel(cat, loadBuildFile(cat, killerFile), rules(), noWarn);
    expect(v.map((x) => [x.kind, x.rowIndex, x.text])).toEqual([
      ['combo-ban', 1, 'Build 2: may not bring "Scourge Hook: Pain Resonance" and "Pop Goes the Weasel" together.'],
      ['perk-banned', 2, 'Build 3: "Dead Man\'s Switch" is not on the allowed killer perk list.'],
      ['perk-banned', 2, 'Build 3: "Starstruck" is not on the allowed killer perk list.'],
    ]);
    expect(v[0]!.slots).toEqual([{ group: 'perk', index: 0 }, { group: 'perk', index: 1 }]);
  });

  it('flags the survivor fixture violations (item moot-suppression included)', () => {
    const v = validateModel(cat, loadBuildFile(cat, survivorFile), rules(), noWarn);
    expect(v.map((x) => [x.kind, x.text])).toEqual([
      ['perk-banned', 'Survivor 2: "Empathy" is not on the allowed survivor perk list.'],
      ['item-banned', 'Survivor 2: "First Aid Kit" is not on the allowed item list.'],
      ['combo-ban', 'Survivor 3: may not bring "Prove Thyself" and "Botany Knowledge" together.'],
      ['item-addon-banned', 'Survivor 4: "Intense Halogen" is not on the allowed Flashlight add-on list.'],
    ]);
    // Survivor 2's Rubber Gloves add-on is not reported because the item itself is banned.
  });

  it('orders kinds within a row and flags a banned power add-on', () => {
    const model = parse({
      killer: 'The Trapper',
      builds: [{ perks: ['Dead Man\'s Switch', 'Scourge Hook: Pain Resonance', 'Pop Goes the Weasel'], addons: ['Trapper Bag'] }],
    });
    const strict = loadRulesContext(cat, rulesFile, undefined, noWarn);
    strict.allowedKillerAddons = new Set();
    const v = validateModel(cat, model, strict, noWarn);
    expect(v.map((x) => x.kind)).toEqual(['perk-banned', 'addon-banned', 'combo-ban']);
    expect(VIOLATION_KIND_ORDER['item-banned']).toBeLessThan(VIOLATION_KIND_ORDER['item-addon-banned']);
    expect(joinWithAnd(['"A"', '"B"', '"C"'])).toBe('"A", "B" and "C"');
  });

  it('enforces single-build pick limits', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-rules-'));
    const f = path.join(tmp, 'r.yaml');
    fs.writeFileSync(
      f,
      'killer: The Trapper\nkillerPerks: {default: allow}\nkillerPickLimits:\n  - max: 1\n    perks: [Pop Goes the Weasel, Sloppy Butcher, Bamboozle]\naddons: {default: allow}\n',
    );
    const ctx = loadRulesContext(cat, f, undefined, noWarn);
    const model = parse({ killer: 'The Trapper', builds: [{ perks: ['Pop Goes the Weasel', 'Sloppy Butcher'] }] });
    const v = validateModel(cat, model, ctx, noWarn);
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('pick-limit');
    expect(v[0]!.text).toBe(
      'Build 1: may bring at most 1 of "Pop Goes the Weasel", "Sloppy Butcher", "Bamboozle"; brought 2.',
    );
  });

  it('fails on killer mismatch and missing rules killer', () => {
    const other = parse({ killer: 'The Hag', builds: [{}] });
    expect(() => validateModel(cat, other, rules(), noWarn)).toThrow(/Killer mismatch/);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-rules-'));
    const f = path.join(tmp, 'r.yaml');
    fs.writeFileSync(f, 'default: allow\n');
    const ctx = loadRulesContext(cat, f, undefined, noWarn);
    expect(() => validateModel(cat, parse({ killer: 'The Trapper', builds: [{}] }), ctx, noWarn)).toThrow(
      /has no "killer" field/,
    );
    const warnings: string[] = [];
    validateModel(cat, parse({ survivors: [{}] }), ctx, (m) => warnings.push(m));
    expect(warnings[0]).toMatch(/has no killer/);
  });

  it('rejects exhaustion selectors in rules', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-rules-'));
    const f = path.join(tmp, 'r.yaml');
    fs.writeFileSync(f, 'killer: The Trapper\nkillerPerks:\n  default: deny\n  allow: [{exhaustion: true}]\n');
    expect(() => loadRulesContext(cat, f, undefined, noWarn)).toThrow(/exhaustion selectors are no longer supported/);
  });
});

describe('build sheet rendering', () => {
  it('lays out the slot table', () => {
    const k = rowSlots(false).slots;
    const s = rowSlots(true).slots;
    expect(k.filter((x) => x.kind === 'item')).toHaveLength(0);
    expect(s.filter((x) => x.kind === 'item')).toHaveLength(1);
    expect(s.find((x) => x.kind === 'perk')).toMatchObject({ x: 20, y: 10, size: 118 });
    expect(s.find((x) => x.kind === 'item')).toMatchObject({ x: 740, y: 25, size: 88 });
  });

  it('renders sheets with the expected dimensions', async () => {
    const warnings: string[] = [];
    const env = { assetsRoot: root, warn: (m: string) => warnings.push(m) };
    const model = loadBuildFile(cat, survivorFile);
    const plain = await renderSheet(env, { model, violations: null, dateStamp: '2026-01-01 00:00:00' });
    // 4 rows, no rules: exactly 1280x720
    expect([plain.width, plain.height]).toEqual([1280, 720]);
    const v = validateModel(cat, model, rules(), noWarn);
    const withRules = await renderSheet(env, { model, violations: v, rulesPath: rulesFile, dateStamp: 'x' });
    expect(withRules.width).toBe(1280);
    expect(withRules.height).toBe(942);
    const icons = await renderIconSheet(env, { model, violations: v });
    expect([icons.width, icons.height]).toEqual([959, 577]);
    const killerIcons = await renderIconSheet(env, { model: loadBuildFile(cat, killerFile), violations: null });
    expect([killerIcons.width, killerIcons.height]).toEqual([959, 424]);
    expect(warnings).toEqual([]);
  });
});

describe('builds command', () => {
  it('writes sheets for several files and records violations', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-out-'));
    const reporter = newReporter();
    await run(
      { files: [killerFile, survivorFile], out, rules: rulesFile, iconsOnly: true, json: false, strict: false },
      { catalog: cat, assetsRoot: root, reporter },
    );
    expect(fs.readdirSync(out).sort()).toEqual([
      'The-Trapper-killer-builds-icons.png',
      'The-Trapper-killer-builds.png',
      'The-Trapper-survivor-builds-icons.png',
      'The-Trapper-survivor-builds.png',
    ]);
    expect(reporter.files.map((f) => f.violations?.length)).toEqual([3, 4]);
    expect(reporter.hasViolations).toBe(true);
    expect(reporter.files[0]!.violations![0]).toMatchObject({ rule: 'combo-ban', row: 2 });
  });

  it('without --rules records no violations', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builds-out-'));
    const reporter = newReporter();
    await run(
      { files: [killerFile], out, iconsOnly: false, json: false, strict: true },
      { catalog: cat, assetsRoot: root, reporter },
    );
    expect(reporter.hasViolations).toBe(false);
    expect(reporter.files[0]!.violations).toBeUndefined();
  });

  it('errors without input files', async () => {
    await expect(
      run({ files: [], out: '/tmp/x', iconsOnly: false, json: false, strict: false }, { catalog: cat, assetsRoot: root, reporter: newReporter() }),
    ).rejects.toThrow(SheetError);
  });
});
