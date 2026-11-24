import { SheetError } from '../errors.js';
import type { CommandContext, CommandOptions } from './types.js';

/** `dbd-sheet builds` (stub). */
export async function run(_opts: CommandOptions, _ctx: CommandContext): Promise<void> {
  throw new SheetError('builds: not implemented yet');
}
