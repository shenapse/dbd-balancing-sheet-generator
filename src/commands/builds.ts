import path from 'node:path';
import { SheetError } from '../errors.js';
import { formatDateStamp, renderIconSheet, renderSheet } from '../render/build-sheet.js';
import { savePng } from '../render/primitives.js';
import { loadBuildFile, outputFilename } from '../rules/build-file.js';
import { loadRulesContext, validateModel, type BuildViolation } from '../rules/build-rules.js';
import type { RunCommand } from './types.js';

/**
 * `dbd-sheet builds <file.yaml...>`: one build sheet (and optional icons-only strip) per file,
 * optionally checked against an allow-list with `--rules`. Violations are findings to render and
 * report, not errors; `--strict` (handled by the CLI) turns them into exit code 1.
 */
export const run: RunCommand = async (opts, ctx) => {
  if (opts.files.length === 0) {
    throw new SheetError('builds: no input files given.\n\nUsage: dbd-sheet builds <builds.yaml...> [options]');
  }
  const { catalog, assetsRoot, reporter } = ctx;
  const outDir = path.resolve(opts.out);
  // One stamp per run so a batch shares a consistent timestamp.
  const dateStamp = formatDateStamp();

  // Parsed once and reused across files: perk/item/add-on rules don't depend on the build file.
  const rules = opts.rules
    ? loadRulesContext(catalog, opts.rules, opts.universesDir, (m) => reporter.warn(m))
    : null;

  for (const input of opts.files) {
    const abs = path.resolve(input);
    const warn = (m: string): void => reporter.warn(m, input);
    reporter.file(input);
    const model = loadBuildFile(catalog, abs);

    const violations: BuildViolation[] | null = rules ? validateModel(catalog, model, rules, warn) : null;
    const env = { assetsRoot, warn };

    const sheet = await renderSheet(env, { model, violations, rulesPath: rules?.rulesPath, dateStamp });
    const sheetPath = path.join(outDir, outputFilename(model, false));
    reporter.claim(input, sheetPath);
    await savePng(sheet, sheetPath);
    reporter.output(input, sheetPath);

    if (opts.iconsOnly) {
      const icons = await renderIconSheet(env, { model, violations });
      const iconsPath = path.join(outDir, outputFilename(model, true));
      reporter.claim(input, iconsPath);
      await savePng(icons, iconsPath);
      reporter.output(input, iconsPath);
    }

    reporter.log(`[${path.basename(abs)}] ${model.isSurvivorSheet ? 'survivor' : 'killer'} side, ${model.rows.length} row(s)`);
    if (violations) {
      reporter.violations(
        input,
        violations.map((v) => ({
          rule: v.kind,
          message: v.text,
          row: v.rowIndex + 1,
          slots: v.slots.map((s) => `${s.group}:${s.index + 1}`),
        })),
      );
      if (violations.length) {
        reporter.log(`  Violations (${violations.length}):\n${violations.map((v) => `    - ${v.text}`).join('\n')}`);
      } else {
        reporter.log('  Violations: none');
      }
    }
  }
};
