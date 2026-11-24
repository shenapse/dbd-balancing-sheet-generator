import path from 'node:path';
import { now } from '../clock.js';
import { SheetError } from '../errors.js';
import { DEFAULT_COLUMNS, perkSheetPath, renderIconSheet, renderSheet } from '../render/perk-sheet.js';
import { loadPerkAllowlist } from '../rules/perk-allowlist.js';
import type { RunCommand } from './types.js';

/**
 * `dbd-sheet perks <allowlist.yaml...>`: for each file render
 * `<Killer-Name>-killer-perks.png` and `-survivor-perks.png` (plus `-perks-icons.png` variants
 * with --icons-only) into `--out`.
 */
export const run: RunCommand = async (opts, ctx) => {
  if (opts.files.length === 0) throw new SheetError('perks: no input files given.\n\nUsage: dbd-sheet perks <allowlist.yaml...> [options]');
  const { reporter, catalog, assetsRoot } = ctx;
  const columns = opts.columns ?? DEFAULT_COLUMNS;
  const dateLabel = now().toISOString().slice(0, 10);
  const outDir = path.resolve(opts.out);

  for (const input of opts.files) {
    const abs = path.resolve(input);
    const warn = (m: string): void => reporter.warn(m, input);
    reporter.file(input);
    const al = loadPerkAllowlist(catalog, abs, { universesDir: opts.universesDir, warn });
    const killerSlug = al.killer.name.replace(/\s+/g, '-');
    const env = { assetsRoot, warn };

    reporter.log(
      `[${al.killer.name}] allowed killer perks: ${al.allowedKiller.length}, survivor perks: ${al.allowedSurvivor.length}`,
    );
    const sides = [
      { side: 'killer', perks: al.allowedKiller, limits: al.killerBuckets },
      { side: 'survivor', perks: al.allowedSurvivor, limits: al.survivorBuckets },
    ] as const;
    // Claim output names up front (same naming as the renderer) so a collision fails before any write.
    for (const s of sides) reporter.claim(input, perkSheetPath(outDir, killerSlug, s.side));
    if (opts.iconsOnly) {
      for (const s of sides) reporter.claim(input, perkSheetPath(outDir, killerSlug, s.side, true));
    }
    for (const s of sides) {
      const out = await renderSheet(env, {
        killer: al.killer,
        perks: s.perks,
        side: s.side,
        columns,
        outDir,
        killerSlug,
        balancing: al.balancing,
        dateLabel,
        limits: s.limits,
      });
      reporter.output(input, out);
    }
    if (opts.iconsOnly) {
      for (const s of sides) {
        const out = await renderIconSheet(env, { perks: s.perks, side: s.side, columns, outDir, killerSlug });
        if (out) reporter.output(input, out);
        else reporter.log(`skipped ${s.side} icons (no allowed perks)`);
      }
    }
  }
};
