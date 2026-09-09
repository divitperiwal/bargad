import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { app } from '#app';
import { db } from '#config/database.config';
import { auditLog, familyMembers } from '#database/schema';
import { addMember, createFamily, createUser, signIn } from '#test/integration/fixtures';

const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data };
};

describe('create family', () => {
  test('makes the caller head with relationship self and records the audit event', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);

    const res = await send('POST', '/families', { name: 'Mehta' }, headers);

    expect(res.status).toBe(201);
    expect(res.data.family.name).toBe('Mehta');
    expect(new Date(res.data.family.createdAt).toISOString()).toBe(res.data.family.createdAt);
    expect(res.data.me).toMatchObject({
      familyId: res.data.family.id,
      userId: user.id,
      role: 'head',
      relationship: 'self',
      canTrade: true,
    });
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'family.created'));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.subjectUserId).toBe(user.id);
  });

  test('rejects a second family for the same user', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);
    await send('POST', '/families', { name: 'Mehta' }, headers);

    const res = await send('POST', '/families', { name: 'Other' }, headers);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_in_family');
  });

  test('turns a simultaneous double create into one 201 and one 409, never a 500', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);

    const results = await Promise.all([
      send('POST', '/families', { name: 'One' }, headers),
      send('POST', '/families', { name: 'Two' }, headers),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await db.select().from(familyMembers).where(eq(familyMembers.userId, user.id));
    expect(rows).toHaveLength(1);
  });
});

describe('current family', () => {
  test('lists active members with names and omits one who left', async () => {
    const head = await createUser({ displayName: 'Hema Mehta' });
    const mum = await createUser({ displayName: 'Mum Mehta' });
    const gone = await createUser({ displayName: 'Gone Mehta' });
    const { family } = await createFamily(head.id);
    await addMember(family.id, mum.id, 'dependent_parent');
    const left = await addMember(family.id, gone.id, 'spouse');
    await db
      .update(familyMembers)
      .set({ leftAt: new Date().toISOString(), leftReason: 'left' })
      .where(eq(familyMembers.id, left.id));

    const res = await send('GET', '/families/current', undefined, await signIn(mum.id));

    expect(res.status).toBe(200);
    expect(res.data.family.id).toBe(family.id);
    expect(res.data.me.userId).toBe(mum.id);
    const joinedAt = res.data.members[0].joinedAt;
    expect(new Date(joinedAt).toISOString()).toBe(joinedAt);
    expect(res.data.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual([
      'Hema Mehta',
      'Mum Mehta',
    ]);
  });

  test('shows canTrade false for an other member', async () => {
    const head = await createUser();
    const friend = await createUser();
    const { family } = await createFamily(head.id);
    await addMember(family.id, friend.id, 'other');

    const res = await send('GET', '/families/current', undefined, await signIn(head.id));

    const member = res.data.members.find((m: { userId: string }) => m.userId === friend.id);
    expect(member.canTrade).toBe(false);
  });

  test('returns 404 not_in_family for a user without a family', async () => {
    const res = await send('GET', '/families/current', undefined, await signIn((await createUser()).id));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_in_family');
  });
});
