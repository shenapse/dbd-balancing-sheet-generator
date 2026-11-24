import { SheetError } from '../errors.js';
import type { CommandContext, CommandOptions } from './types.js';

/** `dbd-sheet addons` (stub). */
export async function run(_opts: CommandOptions, _ctx: CommandContext): Promise<void> {
  throw new SheetError('addons: not implemented yet');
}
