import { describe, expect, test } from 'bun:test';
import { app } from '#app';
import { db } from '#config/database.config';
import { AuditService } from '#modules/core/audit/audit.service';
import { createUser, signIn } from '#test/integration/fixtures';
import { encodeCursor } from '#utils/http/pagination.util';

type Item = {
  id: string;
  at: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  familyId: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown>;
};
type Result = {
  status: number;
  body: { code?: string };
  data: { items: Item[]; nextCursor: string | null; count: number; seenAt: string };
};

const call = async (method: string, path: string, headers: Record<string, string>): Promise<Result> => {
  const res = await app.request(path, { method, headers });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data };
};
const get = (path: string, headers: Record<string, string>) => call('GET', path, headers);

// Each event is its own transaction, so each gets its own timestamp.
const record = (subjectUserIds: string[], actorUserId: string | null, action = 'test.happened') =>
  db.transaction((tx) => AuditService.recordAudit(tx, { action, actorUserId, subjectUserIds }));

// Follows nextCursor until it is null and returns the actions seen, plus the number of pages.
async function readAll(headers: Record<string, string>, limit: number) {
  const actions: string[] = [];
  let pages = 0;
  let cursor: string | null = null;
  do {
    const res: Result = await get(`/feed?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`, headers);
    actions.push(...res.data.items.map((i) => i.action));
    cursor = res.data.nextCursor;
    pages++;
  } while (cursor);
  return { actions, pages };
}

describe('GET /feed', () => {
  test("returns only the caller's rows, newest first, with the actor's name", async () => {
    const me = await createUser();
    const other = await createUser();
    const actor = await createUser({ displayName: 'Asha Rao' });
    await record([me.id, other.id], actor.id, 'first.happened');
    await record([me.id], actor.id, 'second.happened');
    await record([other.id], actor.id, 'not-mine.happened');

    const res = await get('/feed', await signIn(me.id));

    expect(res.status).toBe(200);
    expect(res.data.items.map((i) => i.action)).toEqual(['second.happened', 'first.happened']);
    expect(res.data.items[0]).toMatchObject({
      actorUserId: actor.id,
      actorName: 'Asha Rao',
      familyId: null,
      targetType: null,
      targetId: null,
      detail: {},
    });
    const newest = res.data.items[0];
    expect(typeof newest?.id).toBe('string');
    expect(newest?.at).toBe(new Date(newest?.at ?? '').toISOString());
    expect(res.data.nextCursor).toBeNull();
  });

  test('has a null actorName when the engine acted', async () => {
    const me = await createUser();
    await record([me.id], null);

    const res = await get('/feed', await signIn(me.id));

    expect(res.data.items[0]).toMatchObject({ actorUserId: null, actorName: null });
  });

  test('pages through every row exactly once', async () => {
    const me = await createUser();
    for (let n = 1; n <= 5; n++) await record([me.id], null, `event.${n}`);

    const { actions, pages } = await readAll(await signIn(me.id), 2);

    expect(actions).toEqual(['event.5', 'event.4', 'event.3', 'event.2', 'event.1']);
    expect(pages).toBe(3);
  });

  test('neither skips nor repeats rows that share one timestamp across a page boundary', async () => {
    const me = await createUser();
    await db.transaction(async (tx) => {
      for (let n = 1; n <= 5; n++) {
        await AuditService.recordAudit(tx, { action: `same.${n}`, actorUserId: null, subjectUserIds: [me.id] });
      }
    });

    const { actions } = await readAll(await signIn(me.id), 2);

    expect(actions).toEqual(['same.5', 'same.4', 'same.3', 'same.2', 'same.1']);
  });

  test('rejects a cursor that is not one of ours', async () => {
    const headers = await signIn((await createUser()).id);
    const wrongShape = Buffer.from(JSON.stringify({ at: 5 })).toString('base64url');

    for (const cursor of ['garbage', wrongShape]) {
      const res = await get(`/feed?cursor=${cursor}`, headers);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_cursor');
    }
  });

  test.each([
    { at: 'abc', id: '1' },
    { at: '2026-11-15 00:00:00+00', id: '99999999999999999999' },
    { at: '2026-13-45 00:00:00+00', id: '1' },
    { at: '2026-02-30 00:00:00+00', id: '1' },
  ])('rejects the well-shaped but invalid cursor %o with 400, not a database error', async (value) => {
    const headers = await signIn((await createUser()).id);

    const res = await get(`/feed?cursor=${encodeCursor(value)}`, headers);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  test('rejects a limit above 100', async () => {
    const headers = await signIn((await createUser()).id);

    const res = await get('/feed?limit=500', headers);

    expect(res.status).toBe(400);
  });

  test('requires sign-in', async () => {
    expect((await get('/feed', {})).status).toBe(401);
  });
});

describe('unread count and read marker', () => {
  test('ignores other users’ rows', async () => {
    const me = await createUser();
    const other = await createUser();
    await record([me.id], null);
    await record([other.id], null);
    await record([other.id], null);

    const res = await get('/feed/unread-count', await signIn(me.id));

    expect(res.data.count).toBe(1);
  });

  test('counts everything at first, nothing after the marker, then new events', async () => {
    const me = await createUser();
    const headers = await signIn(me.id);
    await record([me.id], null);
    await record([me.id], null);

    expect((await get('/feed/unread-count', headers)).data.count).toBe(2);

    const marked = await call('PUT', '/feed/read-marker', headers);
    expect(marked.status).toBe(200);
    expect(marked.data.seenAt).toBe(new Date(marked.data.seenAt).toISOString());
    expect((await get('/feed/unread-count', headers)).data.count).toBe(0);

    await record([me.id], null);
    expect((await get('/feed/unread-count', headers)).data.count).toBe(1);
  });
});
