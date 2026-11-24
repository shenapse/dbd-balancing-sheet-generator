import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAssetsRef } from '../src/assets/root.js';
import { SheetError } from '../src/errors.js';
import { Reporter } from '../src/report.js';

const meta = { tool: 't', version: '0', assetsRef: null, command: 'perks' };
const REPO = path.resolve(import.meta.dirname, '..');

describe('Reporter output collisions', () => {
  it('throws when two inputs claim the same output path', () => {
    const r = new Reporter(meta, true);
    r.output('a.yaml', '/out/x.png');
    expect(() => r.output('b.yaml', '/out/x.png')).toThrow(SheetError);
    expect(() => r.output('b.yaml', '/out/x.png')).toThrow(/would be written twice in one run \(from a\.yaml and b\.yaml\)/);
  });
  it('allows the same input to re-register and different paths', () => {
    const r = new Reporter(meta, true);
    r.claim('a.yaml', '/out/x.png');
    r.output('a.yaml', '/out/x.png');
    r.output('b.yaml', '/out/y.png');
  });
});

describe('cli', () => {
  const run = (args: string[]) =>
    spawnSync('npx', ['tsx', path.join(REPO, 'src/cli.ts'), ...args], { encoding: 'utf8', cwd: REPO });
  it('--json emits a summary with error on SheetError, exit 2', () => {
    const r = run(['perks', 'does-not-exist.yaml', '--json']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^error: /);
    const j = JSON.parse(r.stdout);
    expect(j.command).toBe('perks');
    expect(typeof j.error).toBe('string');
  });
  it('items and builds reject --columns', () => {
    for (const c of ['items', 'builds']) {
      const r = run([c, 'x.yaml', '--columns', '3']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--columns is not supported/);
    }
  });
  it('perks fails on a duplicate output across inputs', () => {
    const f = path.join(REPO, 'test/fixtures/perks/the-trapper.yaml');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bsg-dup-'));
    const copy = path.join(out, 'copy.yaml');
    fs.copyFileSync(f, copy);
    const r = run(['perks', f, copy, '--out', out, '--json']);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toMatch(/written twice/);
  });
}, 120_000);

describe('readAssetsRef', () => {
  it('ignores a parent repository', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bsg-ref-'));
    execFileSync('git', ['init', '-q', parent]);
    const sub = path.join(parent, 'assets');
    fs.mkdirSync(sub);
    expect(readAssetsRef(sub)).toBeNull();
  });
});
