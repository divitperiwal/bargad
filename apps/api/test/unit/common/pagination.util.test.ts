import { expect, test } from 'bun:test';
import { paginationQuerySchema } from '@bargad/shared';
import { ApiError } from '#utils/http/error.util';
import { decodeCursor, encodeCursor } from '#utils/http/pagination.util';

test('a cursor round-trips through encode and decode', () => {
  const value = { at: 'x', id: '7' };
  expect(decodeCursor(encodeCursor(value))).toEqual(value);
});

test('a garbled cursor is a 400 invalid_cursor', () => {
  expect(() => decodeCursor('%%%')).toThrow(ApiError);
  try {
    decodeCursor('%%%');
  } catch (err) {
    expect(err).toMatchObject({ status: 400, code: 'invalid_cursor' });
  }
});

test('pagination defaults to 20 items and caps at 100', () => {
  expect(paginationQuerySchema.parse({}).limit).toBe(20);
  expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
});
