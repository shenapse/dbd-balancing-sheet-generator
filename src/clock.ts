import { SheetError } from './errors.js';

/**
 * The time printed on generated sheets. Honours `SOURCE_DATE_EPOCH` (seconds since the Unix
 * epoch, see https://reproducible-builds.org/specs/source-date-epoch/) so output can be made
 * byte-for-byte reproducible, e.g. when regression-testing a Docker image against the goldens.
 */
export function now(): Date {
  const epoch = process.env.SOURCE_DATE_EPOCH?.trim();
  if (!epoch) return new Date();
  if (!/^\d+$/.test(epoch)) {
    throw new SheetError(`SOURCE_DATE_EPOCH must be a non-negative integer (seconds), got "${epoch}".`);
  }
  return new Date(Number(epoch) * 1000);
}
