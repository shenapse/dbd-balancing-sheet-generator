import { RARITY } from '../assets/catalog.js';
import { SheetError } from '../errors.js';
import { normalize } from '../match/normalize.js';

export { RARITY };

/** Number of valid rarities for killer power add-ons (Common .. Ultra Rare). */
export const POWER_ADDON_RARITY_COUNT = 5;
/** Number of valid rarities for items and item add-ons (adds Event). */
export const ITEM_RARITY_COUNT = RARITY.length;

/**
 * Resolve a rarity selector value (name such as "Very Rare" or numeric index) to an index.
 * @param value   YAML value of `{rarity: ...}` / `{tier: ...}`
 * @param source  file path used in error messages
 * @param count   number of valid rarities ({@link POWER_ADDON_RARITY_COUNT} or {@link ITEM_RARITY_COUNT})
 * @throws SheetError when the value is out of range or unknown
 */
export function rarityToIndex(value: unknown, source: string, count: number = POWER_ADDON_RARITY_COUNT): number {
  const names = RARITY.slice(0, count);
  if (typeof value === 'number') {
    if (value >= 0 && value < count) return value;
    throw new SheetError(`Rarity index ${value} out of range (0-${count - 1}) in "${source}".`);
  }
  const norm = normalize(String(value));
  const idx = names.findIndex((n) => normalize(n) === norm);
  if (idx === -1) {
    throw new SheetError(
      `Unknown rarity "${String(value)}" in "${source}". Expected one of: ${names.join(', ')} (or a 0-${count - 1} index).`,
    );
  }
  return idx;
}

/** Every record of `universe` whose rarity matches `value` (see {@link rarityToIndex}). */
export function selectByRarity<T extends { rarity: number }>(
  universe: readonly T[],
  value: unknown,
  source: string,
  count: number,
): T[] {
  const idx = rarityToIndex(value, source, count);
  return universe.filter((e) => e.rarity === idx);
}
