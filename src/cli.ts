#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCatalog } from './assets/catalog.js';
import { readAssetsRef, resolveAssetsRoot } from './assets/root.js';
import type { CommandContext, CommandOptions, RunCommand } from './commands/types.js';
import { SheetError } from './errors.js';
import { Reporter } from './report.js';

const USAGE = `Usage: dbd-sheet <command> [files...] [options]

Commands:
  perks   <allowlist.yaml...>   perk allow-list sheets
  addons  <allowlist.yaml...>   power add-on sheets
  items   <allowlist.yaml...>   item / item add-on sheets
  builds  <builds.yaml...>      build sheets
  version                       print tool version and dbd-assets ref

Options:
  --out <dir>             output directory (default ./output)
  --columns <n>           icon columns (perks and addons only)
  --rules <file>          rules file (builds)
  --universes-dir <dir>   universe files directory
  --icons-only            render icons only
  --json                  print a JSON summary on stdout
  --strict                exit 1 if violations are found
  -h, --help              show this help

Environment:
  DBD_ASSETS_ROOT   local checkout or Git URL (default /opt/dbd-assets)
  DBD_ASSETS_REF    remote commit, tag, or branch (default HEAD)
  DBD_ASSETS_CACHE  directory for cached remote checkouts
`;

const COMMANDS = ['perks', 'addons', 'items', 'builds'] as const;

function packageVersion(): string {
  // Docker images set BSG_VERSION from the release tag; package.json is only the source-checkout version.
  const env = process.env.BSG_VERSION?.trim();
  if (env && env !== 'dev') return env;
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

/** Parse flags shared by all commands. Unknown flags throw SheetError. */
export function parseCommandOptions(argv: string[]): { opts: CommandOptions; help: boolean } {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        columns: { type: 'string' },
        rules: { type: 'string' },
        'universes-dir': { type: 'string' },
        'icons-only': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    throw new SheetError(`${(e as Error).message}\n\n${USAGE}`);
  }
  let columns: number | undefined;
  if (values.columns !== undefined) {
    columns = Number(values.columns);
    if (!Number.isInteger(columns) || columns < 1) throw new SheetError(`--columns must be a positive integer, got "${values.columns}".`);
  }
  const opts: CommandOptions = {
    files: positionals,
    out: values.out ?? './output',
    iconsOnly: values['icons-only'] ?? false,
    json: values.json ?? false,
    strict: values.strict ?? false,
    ...(columns !== undefined ? { columns } : {}),
    ...(values.rules !== undefined ? { rules: values.rules } : {}),
    ...(values['universes-dir'] !== undefined ? { universesDir: values['universes-dir'] } : {}),
  };
  return { opts, help: values.help ?? false };
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  const version = packageVersion();
  if (cmd === 'version') {
    let ref: string | null = null;
    try {
      ref = readAssetsRef(resolveAssetsRoot());
    } catch {
      /* assets not available: still print the version */
    }
    process.stdout.write(`balancing-sheet-generator ${version}\ndbd-assets ${ref ?? 'unknown'}\n`);
    return 0;
  }
  if (!(COMMANDS as readonly string[]).includes(cmd)) {
    throw new SheetError(`Unknown command "${cmd}".\n\n${USAGE}`);
  }
  const { opts, help } = parseCommandOptions(rest);
  if (help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (opts.columns !== undefined && (cmd === 'items' || cmd === 'builds')) {
    throw new SheetError(`--columns is not supported by "${cmd}" (perks and addons only).`);
  }
  const assetsRoot = resolveAssetsRoot();
  const reporter = new Reporter(
    { tool: 'balancing-sheet-generator', version, assetsRef: readAssetsRef(assetsRoot), command: cmd },
    false,
  );
  // Make the reporter reachable from the error handler so --json still gets a summary.
  if (opts.json) failureReporter = reporter;
  const ctx: CommandContext = { catalog: loadCatalog(assetsRoot), assetsRoot, reporter };
  const { run } = (await import(`./commands/${cmd}.js`)) as { run: RunCommand };
  await run(opts, ctx);
  if (opts.json) reporter.emitJson();
  return opts.strict && reporter.hasViolations ? 1 : 0;
}

/** Set once a `--json` run has a reporter; lets failures emit the summary with an `error` field. */
let failureReporter: Reporter | null = null;

function fail(message: string, stderrText: string, code: number): never {
  process.stderr.write(stderrText);
  if (failureReporter) {
    failureReporter.error = message;
    failureReporter.emitJson();
  }
  process.exit(code);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof SheetError) fail(err.message, `error: ${err.message}\n`, 2);
    const message = err instanceof Error ? err.message : String(err);
    fail(message, `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`, 3);
  },
);
