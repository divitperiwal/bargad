import { ApiError } from './error.util';

// Cursors are opaque to clients: base64url of a JSON value the repository understands.
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new ApiError(400, 'Invalid cursor', { code: 'invalid_cursor' });
  }
}

// Repositories fetch limit + 1 rows; the extra row only says another page exists.
export function toPage<T extends { id: string; cursorAt: string }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor({ at: last.cursorAt, id: last.id }) : null;
  return { items: page.map(({ cursorAt: _cursorAt, ...item }) => item), nextCursor };
}

const AT_FORMAT = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

// A cursor timestamp Postgres can cast; anything else would fail the query with a 500.
export const isRealTimestamp = (at: string) => {
  const match = AT_FORMAT.exec(at);
  const date = match?.[1];
  if (!date || Number.isNaN(new Date(at).getTime())) return false;
  return new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);
};
