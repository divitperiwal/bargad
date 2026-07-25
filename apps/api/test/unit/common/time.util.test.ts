import { expect, test } from 'bun:test';
import { toIso, toIsoOrNull } from '#utils/time/time.util';

test('toIso converts a Postgres timestamp to ISO', () => {
  expect(toIso('2026-11-15 00:41:11.921+00')).toBe('2026-11-15T00:41:11.921Z');
});

test('toIsoOrNull keeps null and converts the rest', () => {
  expect(toIsoOrNull(null)).toBeNull();
  expect(toIsoOrNull('2026-11-15 00:41:11.921+00')).toBe('2026-11-15T00:41:11.921Z');
});
