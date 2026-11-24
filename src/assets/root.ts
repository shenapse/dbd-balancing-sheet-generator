import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SheetError } from '../errors.js';

/**
 * Resolve the dbd-assets checkout: `$DBD_ASSETS_ROOT` or `/opt/dbd-assets`
 * (Docker default), as an absolute path. Throws SheetError if it does not
 * look like dbd-assets (needs data/entities and images).
 */
export function resolveAssetsRoot(): string {
  const root = path.resolve(process.env.DBD_ASSETS_ROOT ?? '/opt/dbd-assets');
  for (const sub of ['data/entities', 'images']) {
    if (!fs.existsSync(path.join(root, sub))) {
      throw new SheetError(
        `dbd-assets not found at "${root}" (missing ${sub}). ` +
          'Set DBD_ASSETS_ROOT to a dbd-assets checkout (e.g. DBD_ASSETS_ROOT=../dbd-assets).',
      );
    }
  }
  return root;
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
    const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}
