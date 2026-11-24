import { SheetError } from '../errors.js';

/** `{ default, allow, deny }` block shared by every allow-list section (perks, add-ons, items). */
export interface AllowDenyConfig {
  default?: unknown;
  allow?: readonly unknown[] | null | undefined;
  deny?: readonly unknown[] | null | undefined;
}

/** Options of {@link applyAllowDeny}. */
export interface AllowDenyOptions {
  /** Used when `cfg.default` is missing or falsy. */
  fallbackDefault: 'allow' | 'deny';
  /** Message of the SheetError thrown when `default` is neither "allow" nor "deny". */
  invalidDefaultMessage: string;
}

/**
 * The default / deny / allow engine: seed from `default` (allow = whole universe, deny = empty),
 * remove every `deny` match, then add every `allow` match (allow wins when both list a record).
 *
 * @param universe         every record the section may select from
 * @param cfg              the `{default, allow, deny}` block (null/undefined = defaults)
 * @param resolveSelector  maps one selector to its matching records; throws on unknown selectors
 * @param opts             fallback default and the invalid-default error message
 * @returns the allowed records in insertion order (universe order first), de-duplicated by slug;
 *   callers sort as their legacy tool did
 * @throws SheetError for a `default` other than allow/deny, or whatever `resolveSelector` throws
 */
export function applyAllowDeny<T extends { slug: string }>(
  universe: readonly T[],
  cfg: AllowDenyConfig | null | undefined,
  resolveSelector: (selector: unknown) => T[],
  opts: AllowDenyOptions,
): T[] {
  const def = cfg?.default || opts.fallbackDefault;
  if (def !== 'allow' && def !== 'deny') throw new SheetError(opts.invalidDefaultMessage);
  const allowed = new Map<string, T>();
  if (def === 'allow') for (const e of universe) allowed.set(e.slug, e);
  for (const sel of cfg?.deny ?? []) for (const e of resolveSelector(sel)) allowed.delete(e.slug);
  for (const sel of cfg?.allow ?? []) for (const e of resolveSelector(sel)) allowed.set(e.slug, e);
  return [...allowed.values()];
}
