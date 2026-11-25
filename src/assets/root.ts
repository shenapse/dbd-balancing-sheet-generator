import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SheetError } from '../errors.js';

/**
 * Resolve a local checkout or cache a remote Git repository. A remote commit
 * SHA is fetched once and reused; any other ref (branch, tag, or the default
 * `HEAD`) is checked against the remote on every run, so new assets are picked
 * up automatically. Offline, the last commit fetched for that ref is reused.
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

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
// Git's stderr may contain credentials embedded in the URL, so it is never shown.
const FETCH_FAILED = 'Could not fetch dbd-assets. Check Git is installed, the repository URL and ' +
  'DBD_ASSETS_REF are accessible, and DBD_ASSETS_CACHE is writable.';

const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_TERMINAL_PROMPT: '0' });
const cacheKey = (...parts: string[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/**
 * Cache layout: `commits/<key(url, sha)>` holds one immutable checkout per
 * commit; `refs/<key(url, ref)>` records the commit a mutable ref last
 * resolved to, for offline use.
 */
function resolveRemote(source: string): string {
  const ref = process.env.DBD_ASSETS_REF?.trim() || 'HEAD';
  const cache = path.resolve(process.env.DBD_ASSETS_CACHE ??
    path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'balancing-sheet-generator', 'assets'));
  const checkout = (sha: string): string => path.join(cache, 'commits', cacheKey(source, sha.toLowerCase()));
  const cached = (sha: string | null): string | null => {
    const root = sha ? checkout(sha) : null;
    if (!root || !fs.existsSync(root)) return null;
    validateRoot(root);
    return root;
  };

  if (COMMIT_SHA.test(ref)) return cached(ref) ?? fetchCommit(source, ref, cache, checkout).root;

  const pointer = path.join(cache, 'refs', cacheKey(source, ref));
  let latest: string | null;
  try {
    latest = lsRemote(source, ref);
  } catch {
    const last = readPointer(pointer);
    const root = cached(last);
    if (!root) throw new SheetError(FETCH_FAILED);
    process.stderr.write(`warning: could not check dbd-assets for updates; using cached commit ${last} ` +
      `for ${ref}. Set DBD_ASSETS_REF to a commit SHA to pin it.\n`);
    return root;
  }
  const hit = cached(latest);
  const { root, sha } = hit ? { root: hit, sha: latest! } : fetchCommit(source, ref, cache, checkout);
  writePointer(pointer, sha);
  return root;
}

/** The commit `ref` points to on the remote, or null if it does not resolve to exactly one. */
function lsRemote(source: string, ref: string): string | null {
  const out = execFileSync('git', ['ls-remote', '--', source, ref], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: gitEnv(),
    timeout: 30_000,
  });
  const refs = new Map(out.split('\n').filter(Boolean).map((line) => {
    const [sha = '', name = ''] = line.split('\t');
    return [name, sha] as const;
  }));
  // Annotated tags are listed twice; `<tag>^{}` is the commit they point to.
  const shas = new Set([...refs].filter(([name]) => !name.endsWith('^{}'))
    .map(([name, sha]) => refs.get(`${name}^{}`) ?? sha));
  return shas.size === 1 ? [...shas][0]! : null;
}

function readPointer(pointer: string): string | null {
  try {
    const sha = fs.readFileSync(pointer, 'utf8').trim();
    return COMMIT_SHA.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function writePointer(pointer: string, sha: string): void {
  try {
    fs.mkdirSync(path.dirname(pointer), { recursive: true });
    const temp = `${pointer}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${sha}\n`);
    fs.renameSync(temp, pointer);
  } catch {
    /* only offline fallback depends on it */
  }
}

/** Shallow-fetch `ref` into the commit-keyed cache, atomically. */
function fetchCommit(
  source: string,
  ref: string,
  cache: string,
  checkout: (sha: string) => string,
): { root: string; sha: string } {
  let staging: string | undefined;
  try {
    fs.mkdirSync(path.join(cache, 'commits'), { recursive: true });
    staging = fs.mkdtempSync(path.join(cache, '.fetch-'));
    const git = (...args: string[]): string => execFileSync('git', ['-C', staging!, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv(),
      timeout: 120_000,
    }).trim();
    git('init', '-q');
    git('remote', 'add', 'origin', source);
    git('fetch', '--depth', '1', 'origin', ref);
    git('checkout', '--detach', '-q', 'FETCH_HEAD');
    validateRoot(staging);
    const sha = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(staging, '.ref'), `${sha}\n`);
    const root = checkout(sha);
    try {
      fs.renameSync(staging, root);
    } catch (error) {
      // Another process may have finished fetching the same commit first.
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      validateRoot(root);
    }
    return { root, sha };
  } catch (error) {
    if (error instanceof SheetError) throw error;
    throw new SheetError(FETCH_FAILED);
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
