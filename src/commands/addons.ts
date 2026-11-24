import path from 'node:path';
import { SheetError } from '../errors.js';
import { findKiller } from '../match/lookup.js';
import { DEFAULT_COLUMNS, renderIconSheet, renderSheet } from '../render/addon-sheet.js';
import { savePng } from '../render/primitives.js';
import { parseAddonAllowList, resolveAddonAllowList } from '../rules/addon-allowlist.js';
import { loadYamlFile } from '../rules/yaml.js';
import type { RunCommand } from './types.js';

/** `dbd-sheet addons`: one add-on sheet (and optional icons-only variant) per allow-list file. */
export const run: RunCommand = async (opts, ctx) => {
  if (opts.files.length === 0) throw new SheetError('addons: no input files given.');
  const { catalog, assetsRoot, reporter } = ctx;
  const columns = opts.columns ?? DEFAULT_COLUMNS;
  const dateLabel = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(opts.out);

  for (const input of opts.files) {
    const abs = path.resolve(input);
    reporter.file(input);
    const doc = parseAddonAllowList(loadYamlFile(abs), abs);

    // Resolve the killer record first (aliases work), then use its slug for the add-on lookup.
    const killer = findKiller(catalog, doc.killerText);
    if (!killer) {
      throw new SheetError(`Unknown killer "${doc.killerText}" in file "${abs}". No matching killer in dbd-assets.`);
    }
    const universe = catalog.addonsByKiller.get(killer.slug);
    if (!universe) throw new SheetError(`No add-ons found for killer "${killer.name}" in dbd-assets.`);
    const addons = resolveAddonAllowList(catalog, killer.slug, doc.section, abs);

    const killerSlug = killer.name.replace(/\s+/g, '-');
    const base = { killer, addons, columns, assetsRoot };

    const sheet = await renderSheet({ ...base, balancing: doc.balancing, dateLabel });
    const sheetPath = path.join(outDir, `${killerSlug}-killer-addons.png`);
    await savePng(sheet.canvas, sheetPath);
    reporter.output(input, sheetPath);
    for (const m of sheet.missing) reporter.warn(`missing image (drawn as placeholder): ${m}`, input);

    reporter.log(`[${killer.name}] allowed add-ons: ${addons.length} / ${universe.length}`);

    if (opts.iconsOnly) {
      const icons = await renderIconSheet(base);
      if (icons) {
        const iconsPath = path.join(outDir, `${killerSlug}-killer-addons-icons.png`);
        await savePng(icons.canvas, iconsPath);
        reporter.output(input, iconsPath);
        for (const m of icons.missing) reporter.warn(`missing image (cell skipped): ${m}`, input);
      } else {
        reporter.log('  icons-only skipped: no allowed add-ons');
      }
    }
  }
};
