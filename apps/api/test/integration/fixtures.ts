import { db } from '#config/database.config';
import { setMailer } from '#config/resend.config';
import { SESSION_COOKIE } from '#constant';
import {
  basketItems,
  baskets,
  brokerAccounts,
  brokerSecrets,
  families,
  familyMembers,
  grants,
  holdings,
  instruments,
  ledgerEntries,
  sessions,
  users,
} from '#database/schema';
import type { Mail } from '#integrations/resend/resend.type';
import { hashToken } from '#utils/security/crypto.util';

export async function createUser(fields: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@bargad.test`,
      passwordHash: 'not-a-real-hash',
      displayName: 'Test User',
      ...fields,
    })
    .returning();
  if (!user) throw new Error('user insert returned nothing');
  return user;
}

// Returns headers that sign requests in as the user: app.request(path, { headers }).
export async function signIn(userId: string, client: 'web' | 'app' = 'web'): Promise<Record<string, string>> {
  const token = crypto.randomUUID();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    client,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  return client === 'web' ? { Cookie: `${SESSION_COOKIE}=${token}` } : { Authorization: `Bearer ${token}` };
}

export const TEST_PASSWORD = 'correct horse battery';

export async function createUserWithPassword(fields: Partial<typeof users.$inferInsert> = {}) {
  return createUser({ passwordHash: await Bun.password.hash(TEST_PASSWORD, 'argon2id'), ...fields });
}

// Installs a mailer that collects mail instead of sending it; call inside a test.
export function captureMail(): Mail[] {
  const sent: Mail[] = [];
  setMailer({ send: async (mail) => void sent.push(mail) });
  return sent;
}

// Forgot-password mails after the response, so a test polls for it instead of reading at once.
export async function waitForMail(sent: Mail[], count = 1, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (sent.length < count) {
    if (Date.now() > deadline) throw new Error(`expected ${count} mail, got ${sent.length}`);
    await Bun.sleep(10);
  }
  return sent;
}

export async function createFamily(headUserId: string, name = 'Mehta') {
  const [family] = await db.insert(families).values({ name }).returning();
  if (!family) throw new Error('family insert returned nothing');
  const [head] = await db
    .insert(familyMembers)
    .values({ familyId: family.id, userId: headUserId, role: 'head', relationship: 'self' })
    .returning();
  if (!head) throw new Error('head insert returned nothing');
  return { family, head };
}

export async function addMember(familyId: string, userId: string, relationship = 'dependent_parent') {
  const [member] = await db
    .insert(familyMembers)
    .values({ familyId, userId, role: 'member', relationship })
    .returning();
  if (!member) throw new Error('member insert returned nothing');
  return member;
}

export async function createBrokerAccount(userId: string, fields: Partial<typeof brokerAccounts.$inferInsert> = {}) {
  const [account] = await db
    .insert(brokerAccounts)
    .values({ userId, broker: 'fake', brokerClientId: crypto.randomUUID(), label: 'Test account', ...fields })
    .returning();
  if (!account) throw new Error('broker account insert returned nothing');
  return account;
}

export async function createBrokerSecret(brokerAccountId: string) {
  await db.insert(brokerSecrets).values({ brokerAccountId, credentials: new Uint8Array([1, 2, 3]), keyVersion: 1 });
}

export async function createInstrument(fields: Partial<typeof instruments.$inferInsert> = {}) {
  const id = crypto.randomUUID().replaceAll('-', '').toUpperCase();
  const [instrument] = await db
    .insert(instruments)
    .values({
      exchange: 'NSE',
      tradingSymbol: `T${id.slice(0, 8)}`,
      isin: `IN${id.slice(0, 10)}`,
      name: 'Test Instrument',
      tickSizePaise: 5,
      ...fields,
    })
    .returning();
  if (!instrument) throw new Error('instrument insert returned nothing');
  return instrument;
}

export async function createGrant(
  fields: { familyId: string; grantorUserId: string; granteeUserId: string } & Partial<typeof grants.$inferInsert>,
) {
  const [grant] = await db
    .insert(grants)
    .values({
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      buyCapPaise: 1_000_000,
      sellCapPaise: 1_000_000,
      perOrderCapPaise: 1_000_000,
      ...fields,
    })
    .returning();
  if (!grant) throw new Error('grant insert returned nothing');
  return grant;
}

export async function createBasket(
  fields: { familyId: string; ownerUserId: string; createdBy: string; mode: 'self' | 'approval' | 'grant' } & Partial<
    typeof baskets.$inferInsert
  >,
  items: { brokerAccountId: string; instrumentId: string; side?: 'buy' | 'sell'; quantity?: number }[] = [],
) {
  const [basket] = await db
    .insert(baskets)
    .values({ tradingDay: new Date().toISOString().slice(0, 10), ...fields })
    .returning();
  if (!basket) throw new Error('basket insert returned nothing');
  if (items.length > 0) {
    await db.insert(basketItems).values(
      items.map((item) => ({
        basketId: basket.id,
        ownerUserId: basket.ownerUserId,
        brokerAccountId: item.brokerAccountId,
        instrumentId: item.instrumentId,
        side: item.side ?? 'buy',
        quantity: item.quantity ?? 1,
      })),
    );
  }
  return basket;
}

export async function createHolding(
  brokerAccountId: string,
  instrumentId: string,
  quantity: number,
  avgCostPaise: number,
) {
  const [holding] = await db
    .insert(holdings)
    .values({ brokerAccountId, instrumentId, quantity, avgCostPaise, syncedAt: new Date().toISOString() })
    .returning();
  if (!holding) throw new Error('holding insert returned nothing');
  return holding;
}

export async function createLedgerEntry(userId: string, fields: Partial<typeof ledgerEntries.$inferInsert> = {}) {
  const [entry] = await db
    .insert(ledgerEntries)
    .values({
      userId,
      kind: 'asset',
      type: 'bank_cash',
      name: 'Savings',
      valuePaise: 10_000,
      asOf: '2026-01-01',
      ...fields,
    })
    .returning();
  if (!entry) throw new Error('ledger entry insert returned nothing');
  return entry;
}
