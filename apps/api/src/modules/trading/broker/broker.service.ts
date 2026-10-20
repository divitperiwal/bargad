import type { LinkBrokerAccountInput, SetCredentialsInput, UpdateBrokerAccountInput } from '@bargad/shared';
import { withTransaction } from '#config/database.config';
import { engineConfig } from '#config/engine.config';
import { JOB, JobsRepository } from '#jobs/queue.repository';
import { PasskeyService } from '#modules/accounts/passkey/passkey.service';
import { ApiError } from '#utils/http/error.util';
import { sealForEngine } from '#utils/security/seal.util';
import { audit, notFound, present, requireMayStoreCredentials, requireOwned } from './broker.helper';
import { BrokerRepository } from './broker.repository';

export const BrokerService = {
  list: async (userId: string) => (await BrokerRepository.listOfUser(userId)).map(present),

  link: (userId: string, input: LinkBrokerAccountInput) =>
    withTransaction(async (tx) => {
      const account = await BrokerRepository.insert({ userId, ...input }, tx);
      if (!account) {
        throw new ApiError(409, 'That broker account is already linked', { code: 'broker_account_taken' });
      }
      await JobsRepository.enqueue(
        { kind: JOB.holdingsSync, payload: { brokerAccountId: account.id }, lane: account.id },
        tx,
      );
      await audit(tx, 'broker_account.linked', userId, account.id);
      return present(account);
    }),

  update: (userId: string, id: string, input: UpdateBrokerAccountInput) =>
    withTransaction(async (tx) => {
      const before = await BrokerRepository.findOwned(id, userId, tx);
      if (!before) throw notFound();
      const account = await BrokerRepository.update(id, input, tx);
      if (!account) throw notFound();
      if (input.hidden !== undefined && input.hidden !== before.hidden) {
        await audit(tx, input.hidden ? 'broker_account.hidden' : 'broker_account.unhidden', userId, id);
      }
      return present(account);
    }),

  setCredentials: async (userId: string, id: string, input: SetCredentialsInput) => {
    await requireOwned(userId, id);
    await requireMayStoreCredentials(userId);
    if (!engineConfig.publicKey) {
      throw new ApiError(503, 'Storing credentials is not available right now', { code: 'credentials_unavailable' });
    }
    await PasskeyService.verifyStepUp({
      userId,
      purpose: 'credentials',
      targetId: id,
      assertion: input.assertion,
    });

    const plaintext = new TextEncoder().encode(JSON.stringify({ pin: input.pin, totpSecret: input.totpSecret }));
    const sealed = await sealForEngine(plaintext, Buffer.from(engineConfig.publicKey, 'base64'));
    await withTransaction(async (tx) => {
      await BrokerRepository.upsertCredentials(id, sealed, engineConfig.keyVersion, tx);
      await BrokerRepository.update(id, { loginMethod: 'stored_credentials' }, tx);
      await audit(tx, 'credentials.set', userId, id);
    });
    return { stored: true };
  },

  removeCredentials: async (userId: string, id: string) => {
    await requireOwned(userId, id);
    await withTransaction(async (tx) => {
      await BrokerRepository.clearCredentials(id, tx);
      await BrokerRepository.update(id, { loginMethod: 'broker_login' }, tx);
      await audit(tx, 'credentials.removed', userId, id);
    });
    return { removed: true };
  },
};
