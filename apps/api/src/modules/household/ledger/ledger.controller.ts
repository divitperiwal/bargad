import { ledgerEntrySchema, updateLedgerEntrySchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { idParam } from '#utils/http/param.util';
import { sendSuccess } from '#utils/http/response.util';
import { LedgerService } from './ledger.service';

export const LedgerController = {
  list: createHandlers(async (c) => sendSuccess(c, { items: await LedgerService.list(c.var.user.id) })),

  create: createHandlers(validate('json', ledgerEntrySchema), async (c) => {
    const entry = await LedgerService.create(c.var.user.id, c.req.valid('json'));
    return sendSuccess(c, { entry }, 201);
  }),

  update: createHandlers(validate('param', idParam), validate('json', updateLedgerEntrySchema), async (c) => {
    const entry = await LedgerService.update(c.var.user.id, c.req.valid('param').id, c.req.valid('json'));
    return sendSuccess(c, { entry });
  }),

  remove: createHandlers(validate('param', idParam), async (c) =>
    sendSuccess(c, await LedgerService.remove(c.var.user.id, c.req.valid('param').id)),
  ),
};
