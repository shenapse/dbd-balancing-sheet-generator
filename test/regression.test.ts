/**
 * Golden regression suite: runs each command on the repo's sample inputs and compares the result
 * with what the tool produced when the goldens were last accepted.
 *
 * - PNGs are compared pixel by pixel with test/golden/<case>/*.png.
 * - The JSON summary (outputs, warnings, violations, error) is compared with
 *   test/__snapshots__/regression.test.ts.snap.
 *
 * The clock is frozen so the dates printed on the sheets are stable, and the goldens are only
 * valid for the dbd-assets commit in dbd-assets.ref. After an intended change, re-accept with
 * `npm run test:update` and review the PNG diffs before committing. On a mismatch the actual
 * output and a diff image (mismatching pixels in red) are left in output-regression/<case>/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readAssetsRef } from '../src/assets/root.js';
import { run as addons } from '../src/commands/addons.js';
import { run as builds } from '../src/commands/builds.js';
import { run as items } from '../src/commands/items.js';
import { run as perks } from '../src/commands/perks.js';
import type { RunCommand } from '../src/commands/types.js';
import { SheetError } from '../src/errors.js';
import { Reporter } from '../src/report.js';
import { cat, root } from './helpers.js';

const REPO = path.resolve(import.meta.dirname, '..');
const GOLDEN_DIR = path.join(REPO, 'test/golden');
const ACTUAL_DIR = path.join(REPO, 'output-regression');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const PINNED_REF = fs.readFileSync(path.join(REPO, 'dbd-assets.ref'), 'utf8').trim();
const FROZEN_NOW = new Date('2026-01-01T12:00:00Z');
/** A pixel differs when any RGBA channel differs by more than this (absorbs rasteriser noise). */
const CHANNEL_TOLERANCE = 8;

const COMMANDS: Record<string, RunCommand> = { perks, addons, items, builds };

interface Case {
  name: string;
  command: keyof typeof COMMANDS;
  files: string[];
  rules?: string;
  iconsOnly?: boolean;
}

const FX = 'test/fixtures';
const EX = 'examples/input';
const CASES: Case[] = [
  // Icon-only variants are covered by the Blight cases; the Trapper perk sheets alone are ~3 MB.
  { name: 'perks-the-trapper', command: 'perks', files: [`${FX}/perks/the-trapper.yaml`] },
  { name: 'perks-exhaustion-unsupported', command: 'perks', files: [`${FX}/perks/exhaustion-unsupported.yaml`] },
  { name: 'perks-blight', command: 'perks', files: [`${EX}/blight-allowlist.yaml`], iconsOnly: true },
  { name: 'addons-the-trapper', command: 'addons', files: [`${FX}/addons/the-trapper.yaml`], iconsOnly: true },
  { name: 'addons-alias-killer', command: 'addons', files: [`${FX}/addons/alias-killer.yaml`] },
  { name: 'addons-blight', command: 'addons', files: [`${EX}/blight-allowlist.yaml`], iconsOnly: true },
  { name: 'items-the-trapper', command: 'items', files: [`${FX}/items/the-trapper.yaml`] },
  { name: 'items-blight', command: 'items', files: [`${EX}/blight-allowlist.yaml`], iconsOnly: true },
  {
    name: 'builds-the-trapper',
    command: 'builds',
    files: [`${FX}/builds/the-trapper-killer.yaml`, `${FX}/builds/the-trapper-survivors.yaml`],
    rules: `${FX}/rules/the-trapper.yaml`,
    iconsOnly: true,
  },
  { name: 'builds-the-trapper-no-rules', command: 'builds', files: [`${FX}/builds/the-trapper-killer.yaml`] },
  {
    name: 'builds-blight-survivors',
    command: 'builds',
    files: [`${EX}/blight-survivor-builds.yaml`],
    rules: `${EX}/blight-allowlist.yaml`,
  },
  { name: 'builds-lich-killer', command: 'builds', files: [`${EX}/lich-killer-builds.yaml`], rules: `${EX}/lich-allowlist.yaml` },
];

/** Run one case as the CLI would and return its JSON summary with machine-specific paths removed. */
async function runCase(c: Case, out: string): Promise<unknown> {
  const reporter = new Reporter(
    { tool: 'balancing-sheet-generator', version: 'test', assetsRef: null, command: c.command },
    true,
  );
  try {
    await COMMANDS[c.command]!(
      {
        files: c.files,
        out,
        iconsOnly: c.iconsOnly ?? false,
        json: true,
        strict: false,
        ...(c.rules ? { rules: c.rules } : {}),
      },
      { catalog: cat, assetsRoot: root, reporter },
    );
  } catch (e) {
    if (!(e instanceof SheetError)) throw e;
    reporter.error = e.message;
  }
  const json = JSON.stringify(reporter.toJSON())
    .replaceAll(JSON.stringify(out + path.sep).slice(1, -1), '')
    .replaceAll(JSON.stringify(REPO).slice(1, -1), '<repo>');
  return JSON.parse(json);
}

const listPngs = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];

function pixels(img: Image): Uint8ClampedArray {
  const ctx = createCanvas(img.width, img.height).getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height).data;
}

/** Compare two PNGs; on a mismatch write a diff image to `diffPath` and describe the difference. */
async function diffPng(expectedPath: string, actualPath: string, diffPath: string): Promise<string | null> {
  const [exp, act] = await Promise.all([loadImage(expectedPath), loadImage(actualPath)]);
  if (exp.width !== act.width || exp.height !== act.height) {
    return `size ${act.width}x${act.height}, expected ${exp.width}x${exp.height}`;
  }
  const a = pixels(exp);
  const b = pixels(act);
  const diff = createCanvas(exp.width, exp.height);
  const dctx = diff.getContext('2d');
  const di = dctx.createImageData(exp.width, exp.height);
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(a[i + k]! - b[i + k]!));
    const bad = delta > CHANNEL_TOLERANCE;
    if (bad) count++;
    // Mismatches in red over a faded copy of the actual image.
    di.data[i] = bad ? 255 : b[i]! / 4;
    di.data[i + 1] = bad ? 0 : b[i + 1]! / 4;
    di.data[i + 2] = bad ? 0 : b[i + 2]! / 4;
    di.data[i + 3] = 255;
  }
  if (count === 0) return null;
  dctx.putImageData(di, 0, 0);
  fs.mkdirSync(path.dirname(diffPath), { recursive: true });
  fs.writeFileSync(diffPath, await diff.encode('png'));
  const pct = ((count / (exp.width * exp.height)) * 100).toFixed(3);
  return `${count} pixels (${pct}%) differ; see ${path.relative(REPO, diffPath)}`;
}

describe('golden regression', () => {
  beforeAll(() => {
    const ref = readAssetsRef(root);
    if (ref !== PINNED_REF) {
      throw new Error(
        `Golden images are rendered against dbd-assets ${PINNED_REF} (dbd-assets.ref), but the assets ` +
          `in use are at ${ref ?? 'an unknown commit'}. Unset DBD_ASSETS_ROOT to use the pinned commit, ` +
          'or point it at a checkout of that commit.',
      );
    }
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('has a golden directory only for known cases', () => {
    const names = new Set(CASES.map((c) => c.name));
    const stale = fs.existsSync(GOLDEN_DIR) ? fs.readdirSync(GOLDEN_DIR).filter((d) => !names.has(d)) : [];
    if (UPDATE) {
      for (const d of stale) fs.rmSync(path.join(GOLDEN_DIR, d), { recursive: true });
      return;
    }
    expect(stale, 'golden directories without a case; run `npm run test:update`').toEqual([]);
  });

  it.each(CASES)('$name', async (c) => {
    const out = path.join(ACTUAL_DIR, c.name);
    fs.rmSync(out, { recursive: true, force: true });
    expect(await runCase(c, out)).toMatchSnapshot();

    const golden = path.join(GOLDEN_DIR, c.name);
    const actual = listPngs(out);
    if (UPDATE) {
      fs.rmSync(golden, { recursive: true, force: true });
      if (actual.length) fs.mkdirSync(golden, { recursive: true });
      for (const f of actual) fs.copyFileSync(path.join(out, f), path.join(golden, f));
      fs.rmSync(out, { recursive: true, force: true });
      return;
    }
    expect(actual, 'written PNGs differ from test/golden; run `npm run test:update` if intended').toEqual(listPngs(golden));
    const failures: string[] = [];
    for (const f of actual) {
      const d = await diffPng(path.join(golden, f), path.join(out, f), path.join(out, 'diff', f));
      if (d) failures.push(`${f}: ${d}`);
    }
    expect(failures, 'rendered PNGs differ from test/golden; run `npm run test:update` if intended').toEqual([]);
    // Keep output-regression/ for failing cases only.
    fs.rmSync(out, { recursive: true, force: true });
  });
});
