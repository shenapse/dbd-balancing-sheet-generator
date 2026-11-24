import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAssetsRef, resolveAssetsRoot } from '../src/assets/root.js';
import { SheetError } from '../src/errors.js';

describe('assets sources', () => {
  let temp: string;
  let repo: string;
  let cache: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const commit = () => {
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'assets');
    return git('rev-parse', 'HEAD');
  };

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsg-assets-'));
    repo = path.join(temp, 'remote with spaces');
    cache = path.join(temp, 'cache');
    fs.mkdirSync(path.join(repo, 'data/entities'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'images'));
    fs.writeFileSync(path.join(repo, 'data/entities/entity.json'), '{}');
    fs.writeFileSync(path.join(repo, 'images/icon.png'), 'fixture');
    git('init', '-q');
    commit();
    vi.stubEnv('DBD_ASSETS_ROOT', pathToFileURL(repo).href);
    vi.stubEnv('DBD_ASSETS_CACHE', cache);
    vi.stubEnv('DBD_ASSETS_REF', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it('preserves local paths and validates their contents', () => {
    vi.stubEnv('DBD_ASSETS_ROOT', path.relative(process.cwd(), repo));
    vi.stubEnv('DBD_ASSETS_REF', 'missing-ref');
    expect(resolveAssetsRoot()).toBe(repo);
    expect(fs.existsSync(cache)).toBe(false);
    fs.rmSync(path.join(repo, 'images'), { recursive: true });
    expect(resolveAssetsRoot).toThrow(/missing images/);
  });

  it('fetches remote HEAD, records the commit, and reuses the cache offline', () => {
    const sha = git('rev-parse', 'HEAD');
    const root = resolveAssetsRoot();
    expect(root.startsWith(cache + path.sep)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'images/icon.png'), 'utf8')).toBe('fixture');
    expect(readAssetsRef(root)).toBe(sha);
    fs.rmSync(repo, { recursive: true });
    expect(resolveAssetsRoot()).toBe(root);
  });

  it('fetches pinned commits and tags into separate cache entries', () => {
    const first = git('rev-parse', 'HEAD');
    git('tag', 'v1');
    fs.writeFileSync(path.join(repo, 'images/icon.png'), 'updated');
    const second = commit();
    vi.stubEnv('DBD_ASSETS_REF', first);
    const pinned = resolveAssetsRoot();
    expect(readAssetsRef(pinned)).toBe(first);
    expect(fs.readFileSync(path.join(pinned, 'images/icon.png'), 'utf8')).toBe('fixture');
    vi.stubEnv('DBD_ASSETS_REF', 'v1');
    expect(readAssetsRef(resolveAssetsRoot())).toBe(first);
    vi.stubEnv('DBD_ASSETS_REF', '');
    const latest = resolveAssetsRoot();
    expect(latest).not.toBe(pinned);
    expect(readAssetsRef(latest)).toBe(second);
  });

  it('cleans up failed fetches and allows a retry', () => {
    vi.stubEnv('DBD_ASSETS_REF', 'missing-ref');
    expect(resolveAssetsRoot).toThrow(SheetError);
    expect(fs.readdirSync(cache)).toEqual([]);
    git('tag', 'missing-ref');
    expect(readAssetsRef(resolveAssetsRoot())).toBe(git('rev-parse', 'HEAD'));
  });

  it('rejects a remote repository without the required assets', () => {
    git('rm', '-r', 'images');
    commit();
    expect(resolveAssetsRoot).toThrow(/missing images/);
    expect(fs.readdirSync(cache)).toEqual([]);
  });
});
