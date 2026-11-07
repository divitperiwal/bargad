import { expect, test } from 'bun:test';
import { marketCloseOf, tradingDayFor } from '#utils/time/market.util';

const none = new Set<string>();

test('a weekday before 15:30 IST is that day', () => {
  expect(tradingDayFor(new Date('2026-11-13T09:59:00Z'), none)).toBe('2026-11-13');
});

test('a Friday at 15:30 IST moves to Monday', () => {
  expect(tradingDayFor(new Date('2026-11-13T10:00:00Z'), none)).toBe('2026-11-16');
});

test('a Saturday moves to Monday', () => {
  expect(tradingDayFor(new Date('2026-11-14T06:00:00Z'), none)).toBe('2026-11-16');
});

test('Sunday 23:59 IST moves to Monday', () => {
  expect(tradingDayFor(new Date('2026-11-15T18:29:00Z'), none)).toBe('2026-11-16');
});

test('a holiday moves to the next trading day', () => {
  expect(tradingDayFor(new Date('2026-11-16T03:30:00Z'), new Set(['2026-11-16']))).toBe('2026-11-17');
});

test('the market closes at 15:30 IST', () => {
  expect(marketCloseOf('2026-11-13').toISOString()).toBe('2026-11-13T10:00:00.000Z');
});
