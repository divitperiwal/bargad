import { type LedgerEntryInput, ledgerEntrySchema, type UpdateLedgerEntryInput } from '@bargad/shared';
import { z } from 'zod';
import { ApiError } from '#utils/http/error.util';
import { notFound, toInput } from './ledger.helper';
import { LedgerRepository } from './ledger.repository';

export const LedgerService = {
  list: (userId: string) => LedgerRepository.listOfUser(userId),

  create: (userId: string, input: LedgerEntryInput) => LedgerRepository.insert(userId, input),

  update: async (userId: string, id: string, changes: UpdateLedgerEntryInput) => {
    const current = await LedgerRepository.findOwned(id, userId);
    if (!current) throw notFound();
    // A null (a cleared EMI or interest rate) leaves the field out of the merged entry.
    const withoutCleared = Object.entries({ ...toInput(current), ...changes }).filter(([, value]) => value !== null);
    const merged = ledgerEntrySchema.safeParse(Object.fromEntries(withoutCleared));
    if (!merged.success) {
      throw new ApiError(400, 'Invalid request', { issues: z.flattenError(merged.error).fieldErrors });
    }
    const entry = await LedgerRepository.replace(id, userId, merged.data);
    if (!entry) throw notFound();
    return entry;
  },

  remove: async (userId: string, id: string) => {
    if (!(await LedgerRepository.softDelete(id, userId))) throw notFound();
    return { deleted: true };
  },
};
