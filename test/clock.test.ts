import { afterEach, describe, expect, it, vi } from 'vitest';
import { now } from '../src/clock.js';
import { SheetError } from '../src/errors.js';

describe('now', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('is the current time when SOURCE_DATE_EPOCH is unset or empty', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-06T07:08:09Z'));
    vi.stubEnv('SOURCE_DATE_EPOCH', '');
    expect(now().toISOString()).toBe('2030-05-06T07:08:09.000Z');
  });

  it('honours SOURCE_DATE_EPOCH in seconds', () => {
    vi.stubEnv('SOURCE_DATE_EPOCH', '1767268800');
    expect(now().toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it.each(['-1', '1.5', 'yesterday'])('rejects SOURCE_DATE_EPOCH=%s', (v) => {
    vi.stubEnv('SOURCE_DATE_EPOCH', v);
    expect(() => now()).toThrow(SheetError);
  });
});
