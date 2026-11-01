import { describe, expect, test } from 'bun:test';
import { app } from '#app';
import { createLedgerEntry, createUser, signIn } from '#test/integration/fixtures';

const send = async (method: string, path: string, headers: Record<string, string>, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return {
    status: res.status,
    data: json.data,
    code: json.code as string | undefined,
    issues: json.issues as Record<string, string[]> | undefined,
  };
};

const asset = { kind: 'asset', type: 'fd', name: 'HDFC FD', valuePaise: 2_000_000, asOf: '2026-01-01' };
const liability = {
  kind: 'liability',
  type: 'home_loan',
  name: 'Home loan',
  valuePaise: 5_000_000,
  asOf: '2026-01-01',
  emiPaise: 40_000,
  interestRateBps: 850,
};

const tomorrowIst = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const next = new Date(`${today}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

describe('POST and GET /ledger-entries', () => {
  test('creates an asset and a liability and lists them for the owner only', async () => {
    const owner = await createUser();
    const other = await createUser();
    const headers = await signIn(owner.id);

    const a = await send('POST', '/ledger-entries', headers, asset);
    const l = await send('POST', '/ledger-entries', headers, liability);
    const mine = await send('GET', '/ledger-entries', headers);
    const theirs = await send('GET', '/ledger-entries', await signIn(other.id));

    expect(a.status).toBe(201);
    expect(a.data.entry).toMatchObject({ ...asset, hidden: false, emiPaise: null, interestRateBps: null });
    expect(l.status).toBe(201);
    expect(l.data.entry).toMatchObject(liability);
    expect(mine.data.items.map((e: { id: string }) => e.id).sort()).toEqual([a.data.entry.id, l.data.entry.id].sort());
    expect(mine.data.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(theirs.data.items).toEqual([]);
  });

  test.each([
    ['an asset with an EMI', { ...asset, emiPaise: 100 }, 'emiPaise'],
    ['a liability typed gold', { ...liability, type: 'gold' }, 'type'],
    ['a negative value', { ...asset, valuePaise: -1 }, 'valuePaise'],
    ['a fractional value', { ...asset, valuePaise: 10.5 }, 'valuePaise'],
    ['an unsafe value', { ...asset, valuePaise: 2 ** 60 }, 'valuePaise'],
    ['an as-of date that does not exist', { ...asset, asOf: '2026-02-31' }, 'asOf'],
    ['an as-of date tomorrow', { ...asset, asOf: tomorrowIst() }, 'asOf'],
  ])('rejects %s with 400 and a field issue', async (_name, body, field) => {
    const user = await createUser();

    const res = await send('POST', '/ledger-entries', await signIn(user.id), body);

    expect(res.status).toBe(400);
    expect(Object.keys(res.issues ?? {})).toContain(field);
  });
});

describe('PATCH /ledger-entries/:id', () => {
  test('changes the value and bumps updatedAt', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id);
    const before = (await send('GET', '/ledger-entries', await signIn(user.id))).data.items[0];

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), { valuePaise: 777 });

    expect(res.status).toBe(200);
    expect(res.data.entry.valuePaise).toBe(777);
    expect(new Date(res.data.entry.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  });

  test('rejects a date that does not exist with 400 and an asOf issue', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id);

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), { asOf: '2026-02-31' });

    expect(res.status).toBe(400);
    expect(Object.keys(res.issues ?? {})).toContain('asOf');
  });

  test('answers 404 for a deleted entry', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id);
    await send('DELETE', `/ledger-entries/${entry.id}`, await signIn(user.id));

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), { valuePaise: 1 });

    expect(res.status).toBe(404);
  });

  test('rejects an empty body with 400 invalid_request', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id);

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), {});

    expect(res.status).toBe(400);
    expect(res.code).toBe('invalid_request');
  });

  test('clears a loan’s EMI and interest rate with null', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id, {
      kind: 'liability',
      type: 'home_loan',
      emiPaise: 40_000,
      interestRateBps: 850,
    });

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), {
      emiPaise: null,
      interestRateBps: null,
    });

    expect(res.status).toBe(200);
    expect(res.data.entry).toMatchObject({ emiPaise: null, interestRateBps: null, valuePaise: entry.valuePaise });
  });

  test('rejects an EMI on an asset', async () => {
    const user = await createUser();
    const entry = await createLedgerEntry(user.id);

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(user.id), { emiPaise: 100 });

    expect(res.status).toBe(400);
  });

  test("answers 404 for someone else's entry", async () => {
    const owner = await createUser();
    const other = await createUser();
    const entry = await createLedgerEntry(owner.id);

    const res = await send('PATCH', `/ledger-entries/${entry.id}`, await signIn(other.id), { valuePaise: 1 });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /ledger-entries/:id', () => {
  test('removes the entry from the list and then answers 404', async () => {
    const user = await createUser();
    const headers = await signIn(user.id);
    const entry = await createLedgerEntry(user.id);

    const first = await send('DELETE', `/ledger-entries/${entry.id}`, headers);
    const list = await send('GET', '/ledger-entries', headers);
    const again = await send('DELETE', `/ledger-entries/${entry.id}`, headers);

    expect(first.status).toBe(200);
    expect(first.data).toEqual({ deleted: true });
    expect(list.data.items).toEqual([]);
    expect(again.status).toBe(404);
  });
});

describe("DELETE someone else's entry", () => {
  test('answers 404 and leaves the entry in place', async () => {
    const owner = await createUser();
    const other = await createUser();
    const entry = await createLedgerEntry(owner.id);

    const res = await send('DELETE', `/ledger-entries/${entry.id}`, await signIn(other.id));
    const list = await send('GET', '/ledger-entries', await signIn(owner.id));

    expect(res.status).toBe(404);
    expect(list.data.items).toHaveLength(1);
  });
});
