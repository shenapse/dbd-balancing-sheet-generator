import path from 'node:path';
import { SheetError } from '../errors.js';
import { findKiller } from '../match/lookup.js';
import { buildItemGroups, renderIconSheet, renderSheet } from '../render/item-sheet.js';
import { savePng } from '../render/primitives.js';
import { parseItemAllowList, resolveItemAllowList } from '../rules/item-allowlist.js';
import { parseItemLimits } from '../rules/item-limits.js';
import { loadYamlFile } from '../rules/yaml.js';
import type { RunCommand } from './types.js';

/** `dbd-sheet items`: one item sheet (and optional icons-only variant) per allow-list file. */
export const run: RunCommand = async (opts, ctx) => {
  if (opts.files.length === 0) throw new SheetError('items: no input files given.');
  const { catalog, assetsRoot, reporter } = ctx;
  const dateLabel = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(opts.out);

  for (const input of opts.files) {
    const abs = path.resolve(input);
    reporter.file(input);
    const doc = parseItemAllowList(loadYamlFile(abs), abs);
    const killer = findKiller(catalog, doc.killerText);
    if (!killer) {
      throw new SheetError(`Unknown killer "${doc.killerText}" in file "${abs}". No matching killer in dbd-assets.`);
    }

    const types = resolveItemAllowList(catalog, doc.items, doc.topDefault, abs);
    const limits = parseItemLimits(catalog, doc.raw, types, abs, (m) => reporter.warn(m, input));
    const groups = buildItemGroups(types);
    const killerSlug = killer.name.replace(/\s+/g, '-');

    const sheet = await renderSheet({ killer, groups, limits, balancing: doc.balancing, dateLabel, assetsRoot });
    const sheetPath = path.join(outDir, `${killerSlug}-items.png`);
    reporter.claim(input, sheetPath);
    await savePng(sheet.canvas, sheetPath);
    reporter.output(input, sheetPath);
    for (const m of sheet.missing) reporter.warn(`missing image (drawn as placeholder): ${m}`, input);

    reporter.log(
      `[${killer.name}] allowed items: ${types.reduce((n, t) => n + t.variants.length, 0)}\n` +
        types
          .filter((t) => t.variants.length > 0)
          .map((t) => `    ${t.item.name}: ${t.variants.length} item(s), ${t.addons.length} add-on(s)`)
          .join('\n'),
    );

    if (opts.iconsOnly) {
      const icons = await renderIconSheet(groups, assetsRoot);
      if (icons) {
        const iconsPath = path.join(outDir, `${killerSlug}-items-icons.png`);
        reporter.claim(input, iconsPath);
        await savePng(icons.canvas, iconsPath);
        reporter.output(input, iconsPath);
        for (const m of icons.missing) reporter.warn(`missing image (cell skipped): ${m}`, input);
      } else {
        reporter.log('  icons-only skipped: no allowed items');
      }
    }
  }
};
