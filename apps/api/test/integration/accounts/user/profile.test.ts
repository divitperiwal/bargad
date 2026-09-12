import { describe, expect, test } from 'bun:test';
import { app } from '#app';
import { createUser, signIn } from '#test/integration/fixtures';

const send = async (method: string, body: unknown, headers: Record<string, string>) => {
  const res = await app.request('/users/me', {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, data: json.data };
};

describe('GET /users/me', () => {
  test('returns the profile and never the password hash', async () => {
    const user = await createUser({
      displayName: 'Asha Rao',
      mobile: '9876543210',
      dateOfBirth: '1990-05-17',
      monthlyIncomePaise: 5_000_000,
    });

    const res = await send('GET', undefined, await signIn(user.id));

    expect(res.status).toBe(200);
    expect(res.data.user).toEqual({
      id: user.id,
      email: user.email,
      displayName: 'Asha Rao',
      mobile: '9876543210',
      dateOfBirth: '1990-05-17',
      monthlyIncomePaise: 5_000_000,
      monthlyExpensesPaise: null,
      createdAt: new Date(user.createdAt).toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });
});

describe('PATCH /users/me', () => {
  test('updates the name, income and expenses', async () => {
    const headers = await signIn((await createUser()).id);

    const res = await send(
      'PATCH',
      { displayName: 'Asha R', monthlyIncomePaise: 8_000_000, monthlyExpensesPaise: 3_000_000 },
      headers,
    );

    expect(res.status).toBe(200);
    expect(res.data.user).toMatchObject({
      displayName: 'Asha R',
      monthlyIncomePaise: 8_000_000,
      monthlyExpensesPaise: 3_000_000,
    });
    expect((await send('GET', undefined, headers)).data.user.monthlyIncomePaise).toBe(8_000_000);
  });

  test('clears income and expenses with null and leaves omitted fields alone', async () => {
    const user = await createUser({ displayName: 'Keep Me', monthlyIncomePaise: 1, monthlyExpensesPaise: 2 });

    const res = await send('PATCH', { monthlyIncomePaise: null, monthlyExpensesPaise: null }, await signIn(user.id));

    expect(res.status).toBe(200);
    expect(res.data.user).toMatchObject({
      displayName: 'Keep Me',
      monthlyIncomePaise: null,
      monthlyExpensesPaise: null,
    });
  });

  test.each([-1, 1.5, 2 ** 60])('rejects monthlyIncomePaise %p', async (value) => {
    const headers = await signIn((await createUser()).id);

    const res = await send('PATCH', { monthlyIncomePaise: value }, headers);

    expect(res.status).toBe(400);
    expect(res.body.issues.monthlyIncomePaise).toBeDefined();
  });

  test('rejects an empty body and a too-short name', async () => {
    const headers = await signIn((await createUser()).id);

    expect((await send('PATCH', {}, headers)).status).toBe(400);
    expect((await send('PATCH', { displayName: 'A' }, headers)).status).toBe(400);
  });
});
