import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SheetError } from '../errors.js';

/**
 * Resolve a local checkout or cache a remote Git repository. Remote checkouts
 * are reused until the URL/ref changes or their cache entry is removed.
 */
export function resolveAssetsRoot(): string {
  const source = process.env.DBD_ASSETS_ROOT ?? '/opt/dbd-assets';
  const remote = /^(?:https?|ssh|git|file):\/\//i.test(source) || /^[^/\s]+@[^:\s]+:.+/.test(source);
  const root = remote ? resolveRemote(source) : path.resolve(source);
  validateRoot(root);
  return root;
}

function validateRoot(root: string): void {
  for (const sub of ['data/entities', 'images']) {
    if (!fs.statSync(path.join(root, sub), { throwIfNoEntry: false })?.isDirectory()) {
      throw new SheetError(
        `dbd-assets not found at "${root}" (missing ${sub}). ` +
          'Set DBD_ASSETS_ROOT to a dbd-assets checkout or Git repository URL.',
      );
    }
  }
}

function resolveRemote(source: string): string {
  const ref = process.env.DBD_ASSETS_REF?.trim() || 'HEAD';
  const cache = path.resolve(process.env.DBD_ASSETS_CACHE ??
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'balancing-sheet-generator', 'assets'));
  const key = createHash('sha256').update(JSON.stringify([source, ref])).digest('hex');
  const root = path.join(cache, key);
  if (fs.existsSync(root)) {
    validateRoot(root);
    return root;
  }

  let staging: string | undefined;
  try {
    fs.mkdirSync(cache, { recursive: true });
    staging = fs.mkdtempSync(path.join(cache, '.fetch-'));
    const git = (...args: string[]): string => execFileSync('git', ['-C', staging!, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 120_000,
    }).trim();
    git('init', '-q');
    git('remote', 'add', 'origin', source);
    git('fetch', '--depth', '1', 'origin', ref);
    git('checkout', '--detach', '-q', 'FETCH_HEAD');
    validateRoot(staging);
    fs.writeFileSync(path.join(staging, '.ref'), `${git('rev-parse', 'HEAD')}\n`);
    try {
      fs.renameSync(staging, root);
    } catch (error) {
      // Another process may have finished fetching the same URL/ref first.
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      validateRoot(root);
    }
    return root;
  } catch (error) {
    if (error instanceof SheetError) throw error;
    // Git's stderr may contain credentials embedded in the URL.
    throw new SheetError('Could not fetch dbd-assets. Check Git is installed, the repository URL and ' +
      'DBD_ASSETS_REF are accessible, and DBD_ASSETS_CACHE is writable.');
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The dbd-assets commit SHA: contents of `<root>/.ref` if present (written by
 * the Docker build), else `git rev-parse HEAD` in root, else null.
 */
export function readAssetsRef(root: string): string | null {
  try {
    const ref = fs.readFileSync(path.join(root, '.ref'), 'utf8').trim();
    if (ref) return ref;
  } catch {
    /* fall through */
  }
  try {
    const run = (args: string[]): string =>
      execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Only trust the repo if root is its top level, not a plain directory inside some other repo.
    if (fs.realpathSync(run(['rev-parse', '--show-toplevel'])) !== fs.realpathSync(root)) return null;
    return run(['rev-parse', 'HEAD']) || null;
  } catch {
    return null;
  }
}
