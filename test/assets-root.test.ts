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
  /** Cached checkouts and staging directories, ignoring the empty layout directories. */
  const leftovers = () => (fs.readdirSync(cache, { recursive: true }) as string[])
    .filter((entry) => !['commits', 'refs'].includes(entry));

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

  it('fetches remote HEAD and records the commit', () => {
    const sha = git('rev-parse', 'HEAD');
    const root = resolveAssetsRoot();
    expect(root.startsWith(cache + path.sep)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'images/icon.png'), 'utf8')).toBe('fixture');
    expect(readAssetsRef(root)).toBe(sha);
    expect(resolveAssetsRoot()).toBe(root);
  });

  it('picks up new commits on a branch or HEAD without clearing the cache', () => {
    const before = resolveAssetsRoot();
    fs.writeFileSync(path.join(repo, 'images/icon.png'), 'updated');
    const sha = commit();
    const after = resolveAssetsRoot();
    expect(after).not.toBe(before);
    expect(readAssetsRef(after)).toBe(sha);
    expect(fs.readFileSync(path.join(after, 'images/icon.png'), 'utf8')).toBe('updated');
    vi.stubEnv('DBD_ASSETS_REF', git('branch', '--show-current'));
    expect(resolveAssetsRoot()).toBe(after);
  });

  it('falls back to the last fetched commit when the remote is unreachable', () => {
    const root = resolveAssetsRoot();
    const sha = git('rev-parse', 'HEAD');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      fs.rmSync(repo, { recursive: true });
      expect(resolveAssetsRoot()).toBe(root);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining(`using cached commit ${sha}`));
      vi.stubEnv('DBD_ASSETS_REF', 'never-fetched');
      expect(resolveAssetsRoot).toThrow(SheetError);
    } finally {
      stderr.mockRestore();
    }
  });

  it('reuses a pinned commit without contacting the remote', () => {
    const sha = git('rev-parse', 'HEAD');
    vi.stubEnv('DBD_ASSETS_REF', sha);
    const root = resolveAssetsRoot();
    expect(readAssetsRef(root)).toBe(sha);
    fs.rmSync(repo, { recursive: true });
    const stderr = vi.spyOn(process.stderr, 'write');
    try {
      expect(resolveAssetsRoot()).toBe(root);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it('shares one cache entry between refs that resolve to the same commit', () => {
    const first = git('rev-parse', 'HEAD');
    git('tag', 'v1');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'tag', '-a', 'v1-annotated', '-m', 'release');
    fs.writeFileSync(path.join(repo, 'images/icon.png'), 'updated');
    const second = commit();
    vi.stubEnv('DBD_ASSETS_REF', first);
    const pinned = resolveAssetsRoot();
    expect(readAssetsRef(pinned)).toBe(first);
    expect(fs.readFileSync(path.join(pinned, 'images/icon.png'), 'utf8')).toBe('fixture');
    vi.stubEnv('DBD_ASSETS_REF', 'v1');
    expect(resolveAssetsRoot()).toBe(pinned);
    vi.stubEnv('DBD_ASSETS_REF', 'v1-annotated');
    expect(resolveAssetsRoot()).toBe(pinned);
    vi.stubEnv('DBD_ASSETS_REF', '');
    const latest = resolveAssetsRoot();
    expect(latest).not.toBe(pinned);
    expect(readAssetsRef(latest)).toBe(second);
  });

  it('cleans up failed fetches and allows a retry', () => {
    vi.stubEnv('DBD_ASSETS_REF', 'missing-ref');
    expect(resolveAssetsRoot).toThrow(SheetError);
    expect(leftovers()).toEqual([]);
    git('tag', 'missing-ref');
    expect(readAssetsRef(resolveAssetsRoot())).toBe(git('rev-parse', 'HEAD'));
  });

  it('rejects a remote repository without the required assets', () => {
    git('rm', '-r', 'images');
    commit();
    expect(resolveAssetsRoot).toThrow(/missing images/);
    expect(leftovers()).toEqual([]);
  });
});
