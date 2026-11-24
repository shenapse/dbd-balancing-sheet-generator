import type { Catalog } from '../assets/catalog.js';
import type { Reporter } from '../report.js';

/** Parsed shared CLI flags. */
export interface CommandOptions {
  /** Positional input files (YAML). */
  files: string[];
  /** Output directory (default `./output`). */
  out: string;
  /** Icon columns (perk/add-on sheets); undefined = command default. */
  columns?: number;
  /** `--rules` file (builds). */
  rules?: string;
  /** `--universes-dir` (perks/builds). */
  universesDir?: string;
  iconsOnly: boolean;
  json: boolean;
  strict: boolean;
}

/** Shared services handed to every command. */
export interface CommandContext {
  catalog: Catalog;
  /** Absolute dbd-assets root (pass to the *ImagePath helpers). */
  assetsRoot: string;
  reporter: Reporter;
}

/** Signature each src/commands/<name>.ts must export. */
export type RunCommand = (opts: CommandOptions, ctx: CommandContext) => Promise<void>;
